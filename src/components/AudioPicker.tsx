import { FileAudio, Mic, Square, Trash2, UploadCloud, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { decodeAudioFile, formatTime } from "../lib/audio";
import { hasHandoff, takeHandoff } from "../lib/handoff";
import { decodeMonoAt } from "../lib/longAudio";
import {
  isRecordingSupported,
  MicRecorder,
  recordingExtension,
} from "../lib/record";

// The picker's helpers live beside it so every tool imports one module.
// eslint-disable-next-line react-refresh/only-export-components
export const ACCEPTED_EXTENSIONS = [
  "mp3",
  "wav",
  "ogg",
  "oga",
  "flac",
  "m4a",
  "m4b",
  "mp4",
  "aac",
  "opus",
  "webm",
  "aif",
  "aiff",
  "caf",
  "amr",
  "3gp",
  "mov",
  "mkv",
  "wma",
];
/**
 * A file this size decodes to well over a gigabyte of 32-bit samples, which
 * is where a phone stops decoding and starts reloading the tab. The old limit
 * was 150MB and the crash it produced looked like the site being broken
 * rather than the file being too big, so the bar now sits where the decode
 * actually survives.
 */
const MAX_BYTES = 80 * 1024 * 1024;

const ACCEPT = [
  "audio/*",
  "video/*",
  ...ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

// eslint-disable-next-line react-refresh/only-export-components
export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function validateAudioFile(candidate: File, maxBytes = MAX_BYTES): string | null {
  if (candidate.size === 0) return "קובץ האודיו ריק. יש לבחור קובץ שמכיל הקלטה.";
  if (candidate.size > maxBytes) {
    return `הקובץ גדול מ־${formatBytes(maxBytes)}. קצר אותו או המר ל־MP3.`;
  }

  const parts = candidate.name.split(".");
  const extension = parts.length > 1 ? parts.pop()!.toLowerCase() : "";
  // A file picked from a cloud drive on Android very often arrives with an
  // empty type and no extension at all. Rejecting it out of hand was the
  // single most common way an upload failed here, and it failed on a guess:
  // the decoder is the only thing that actually knows, so anything not
  // obviously wrong is handed to it and judged on the result.
  const clearlyNotAudio =
    (candidate.type.startsWith("image/") ||
      candidate.type.startsWith("text/") ||
      candidate.type === "application/pdf") &&
    !ACCEPTED_EXTENSIONS.includes(extension);
  if (clearlyNotAudio) {
    return "זה לא קובץ שמע. אפשר לבחור MP3, WAV, OGG, FLAC, M4A או AAC.";
  }
  return null;
}

export type LoadedAudio = {
  file: File;
  buffer: AudioBuffer;
  url: string;
};

export type AudioFileOptions = {
  /** Take a file another tool handed over, when one is waiting. Default true. */
  acceptHandoff?: boolean;
  /** The largest file to accept; the default suits tools that keep the full-rate audio. */
  maxBytes?: number;
  /**
   * Decode straight to mono at this rate, in pieces where the format allows
   * — for a tool that only needs speech-grade audio and wants a two-hour
   * recording to fit in memory.
   */
  monoAt?: number;
};

/**
 * File state shared by every tool that starts from a song: validation,
 * decoding, the object URL for the native player, and cleanup. Tools only
 * ever see a decoded buffer, so none of them repeats this plumbing.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAudioFile(options: AudioFileOptions = {}) {
  const { maxBytes = MAX_BYTES, monoAt, acceptHandoff = true } = options;
  const [audio, setAudio] = useState<LoadedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  /** 0..1 while a long file is decoded in pieces; null when there is nothing to report. */
  const [progress, setProgress] = useState<number | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  // Picking a second file while the first is still decoding used to leave
  // whichever finished last on screen. The token makes the most recent choice
  // the one that wins, whatever order the decodes come back in.
  const loadTokenRef = useRef(0);

  const load = useCallback(async (candidate?: File | null) => {
    if (!candidate) return;
    const problem = validateAudioFile(candidate, maxBytes);
    if (problem) {
      setError(problem);
      return;
    }
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    setIsLoading(true);
    setProgress(null);
    setError(null);
    try {
      let data: ArrayBuffer;
      try {
        data = await candidate.arrayBuffer();
      } catch {
        // A file handed over by a cloud-drive app can vanish between being
        // chosen and being read, and the browser's own message for that says
        // nothing a person can act on.
        throw new Error(
          "לא הצלחנו לקרוא את הקובץ מהמכשיר. אם הוא נמצא ב־Drive או ב־iCloud, כדאי להוריד אותו למכשיר ולנסות שוב.",
        );
      }
      const buffer = monoAt
        ? await decodeMonoAt(data, monoAt, (fraction) => {
            if (loadTokenRef.current === token) setProgress(fraction);
          })
        : await decodeAudioFile(data);
      if (loadTokenRef.current !== token) return;
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
        throw new Error("הקובץ נפתח אבל אין בו שמע.");
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(candidate);
      urlRef.current = url;
      setAudio({ file: candidate, buffer, url });
    } catch (caught) {
      if (loadTokenRef.current !== token) return;
      const reason = caught instanceof Error ? caught.message : "";
      setError(
        reason
          ? `לא הצלחנו לפתוח את „${candidate.name}”. ${reason}`
          : `לא הצלחנו לפתוח את „${candidate.name}”. ייתכן שהפורמט אינו נתמך בדפדפן הזה — המרה ל־MP3 או ל־WAV בדרך כלל פותרת את זה.`,
      );
    } finally {
      if (loadTokenRef.current === token) {
        setIsLoading(false);
        setProgress(null);
      }
    }
  }, [maxBytes, monoAt]);

  // A file another tool left for this one is opened on arrival.
  useEffect(() => {
    if (!acceptHandoff || !hasHandoff()) return;
    // Taking the file empties the hand-off, so a re-run of this effect
    // (StrictMode in development) finds nothing; the first run's file is
    // opened regardless of the teardown in between.
    void takeHandoff().then((handed) => {
      if (handed) void load(handed.file);
    });
  }, [acceptHandoff, load]);

  const clear = useCallback(() => {
    loadTokenRef.current += 1;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setAudio(null);
    setError(null);
    setIsLoading(false);
    setProgress(null);
  }, []);

  return { audio, error, setError, isLoading, progress, load, clear, maxBytes };
}

type PickerProps = {
  audio: LoadedAudio | null;
  isLoading: boolean;
  /** 0..1 while a long file is decoded in pieces. */
  progress?: number | null;
  /** The limit the hook was given, for the hint under the headline. */
  maxBytes?: number;
  onPick: (file?: File | null) => void;
  onClear: () => void;
  /** Shown under the headline of the drop zone. */
  hint?: string;
  allowRecording?: boolean;
  /** Extra controls rendered beside the file once one is loaded. */
  children?: React.ReactNode;
};

export function AudioPicker({
  audio,
  isLoading,
  progress = null,
  maxBytes = MAX_BYTES,
  onPick,
  onClear,
  hint,
  allowRecording = false,
  children,
}: PickerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [recorder] = useState(() => new MicRecorder());
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);

  const pickFromInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    // Clear first so choosing the same file again still fires change in every
    // browser, including Chrome/Android and Safari/iOS.
    event.currentTarget.value = "";
    if (file) onPick(file);
  };

  useEffect(() => () => recorder.cancel(), [recorder]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setRecordSeconds(recorder.elapsed);
      setMicLevel(recorder.level);
    }, 100);
    return () => window.clearInterval(timer);
  }, [isRecording, recorder]);

  const startRecording = async () => {
    setRecordError(null);
    try {
      await recorder.start();
      setIsRecording(true);
    } catch (caught) {
      setRecordError(
        caught instanceof Error && caught.name === "NotAllowedError"
          ? "לא ניתנה גישה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן."
          : "לא הצלחנו להתחיל הקלטה.",
      );
    }
  };

  const finishRecording = async () => {
    try {
      const blob = await recorder.stop();
      setIsRecording(false);
      setRecordSeconds(0);
      setMicLevel(0);
      if (blob.size < 1000) {
        setRecordError("ההקלטה קצרה מדי. נסה שוב.");
        return;
      }
      onPick(new File([blob], `הקלטה.${recordingExtension(blob)}`, { type: blob.type }));
    } catch {
      setIsRecording(false);
      setRecordError("ההקלטה נכשלה.");
    }
  };

  if (isRecording) {
    return (
      <div className="recording-box">
        <span className="recording-dot" />
        <div className="recording-info">
          <strong>מקליט… {formatTime(recordSeconds)}</strong>
          <div className="level-meter" aria-hidden="true">
            <div style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </div>
          <small>ההקלטה נשארת במכשיר שלך.</small>
        </div>
        <div className="recording-actions">
          <button className="primary-button compact" onClick={finishRecording} type="button">
            <Square size={16} /> סיים
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              recorder.cancel();
              setIsRecording(false);
              setRecordSeconds(0);
              setMicLevel(0);
            }}
            type="button"
          >
            <Trash2 size={16} /> בטל
          </button>
        </div>
      </div>
    );
  }

  if (audio) {
    return (
      <div className="selected-file">
        <span className="file-icon">
          <FileAudio size={28} />
        </span>
        <div className="file-details">
          <strong>{audio.file.name}</strong>
          <span>
            {formatBytes(audio.file.size)} · {formatTime(audio.buffer.duration)} ·{" "}
            {audio.buffer.numberOfChannels === 1 ? "מונו" : "סטריאו"} ·{" "}
            {Math.round(audio.buffer.sampleRate / 100) / 10} kHz
          </span>
        </div>
        {children}
        <label className="secondary-button compact replace-file-button">
          <UploadCloud size={16} /> החלף קובץ
          <input
            className="native-file-input"
            type="file"
            accept={ACCEPT}
            onChange={pickFromInput}
            aria-label="החלפת קובץ שמע"
          />
        </label>
        <button className="icon-button" onClick={onClear} aria-label="הסר קובץ" type="button">
          <X size={18} />
        </button>
      </div>
    );
  }

  return (
    <>
      <label
        className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (isLoading) return;
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (isLoading) return;
          // Dragging a selection of text or an image out of another tab also
          // fires a drop; without the guard that cleared the current song and
          // replaced it with an error.
          const dropped = Array.from(event.dataTransfer.files);
          if (!dropped.length) return;
          const audioish = dropped.find(
            (file) =>
              file.type.startsWith("audio/") ||
              ACCEPTED_EXTENSIONS.includes(
                file.name.split(".").pop()?.toLowerCase() ?? "",
              ),
          );
          onPick(audioish ?? dropped[0]);
        }}
        aria-disabled={isLoading}
      >
        <span className="upload-icon">
          <UploadCloud size={32} />
        </span>
        <strong>
          {isLoading
            ? progress !== null
              ? `מפענח את הקובץ… ${Math.round(progress * 100)}%`
              : "טוען את הקובץ…"
            : "גרור לכאן שיר או לחץ לבחירה"}
        </strong>
        <span>{hint ?? `MP3, WAV, OGG, FLAC, M4A, AAC · עד ${formatBytes(maxBytes)}`}</span>
        {/* The input sits inside the label rather than being clicked from
            script: iOS Safari and several Android WebViews refuse a
            programmatic `.click()` on a file input, which is what made the
            picker simply not open there. A bare `audio/*` also hides files
            whose type the phone failed to work out — on Android that is most
            of what sits in a cloud drive — so the extensions are listed too. */}
        <input
          className="native-file-input"
          type="file"
          accept={ACCEPT}
          disabled={isLoading}
          onChange={pickFromInput}
          aria-label="בחירת קובץ שמע"
        />
      </label>
      {allowRecording && isRecordingSupported() && (
        <div className="source-alternatives">
          <button className="secondary-button" onClick={startRecording} type="button">
            <Mic size={17} /> הקלט מהמיקרופון
          </button>
        </div>
      )}
      {recordError && (
        <div className="error-message" role="alert">
          {recordError}
        </div>
      )}
    </>
  );
}
