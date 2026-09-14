import { FileAudio, Mic, Square, Trash2, UploadCloud, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { decodeAudioFile, formatTime } from "../lib/audio";
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
  "flac",
  "m4a",
  "aac",
  "opus",
  "webm",
];
const MAX_BYTES = 150 * 1024 * 1024;

// eslint-disable-next-line react-refresh/only-export-components
export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function validateAudioFile(candidate: File): string | null {
  if (candidate.size === 0) return "קובץ האודיו ריק. יש לבחור קובץ שמכיל הקלטה.";
  const extension = candidate.name.split(".").pop()?.toLowerCase() ?? "";
  const looksAudio =
    candidate.type.startsWith("audio/") ||
    candidate.type.startsWith("video/") ||
    ACCEPTED_EXTENSIONS.includes(extension);
  if (!looksAudio) {
    return "יש לבחור קובץ אודיו — למשל MP3, WAV, OGG, FLAC, M4A או AAC.";
  }
  if (candidate.size > MAX_BYTES) return "הקובץ גדול מדי. הגודל המרבי הוא 150MB.";
  return null;
}

export type LoadedAudio = {
  file: File;
  buffer: AudioBuffer;
  url: string;
};

/**
 * File state shared by every tool that starts from a song: validation,
 * decoding, the object URL for the native player, and cleanup. Tools only
 * ever see a decoded buffer, so none of them repeats this plumbing.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAudioFile() {
  const [audio, setAudio] = useState<LoadedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const load = useCallback(async (candidate?: File | null) => {
    if (!candidate) return;
    const problem = validateAudioFile(candidate);
    if (problem) {
      setError(problem);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const buffer = await decodeAudioFile(await candidate.arrayBuffer());
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
        throw new Error("קובץ האודיו ריק או פגום.");
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(candidate);
      urlRef.current = url;
      setAudio({ file: candidate, buffer, url });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `לא הצלחנו לפתוח את הקובץ. ${caught.message}`
          : "לא הצלחנו לפתוח את הקובץ.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setAudio(null);
    setError(null);
  }, []);

  return { audio, error, setError, isLoading, load, clear };
}

type PickerProps = {
  audio: LoadedAudio | null;
  isLoading: boolean;
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
            accept=".mp3,.wav,.ogg,.flac,.m4a,.aac,.opus,.webm,audio/*,video/*"
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
          onPick(event.dataTransfer.files[0]);
        }}
        aria-disabled={isLoading}
      >
        <span className="upload-icon">
          <UploadCloud size={32} />
        </span>
        <strong>{isLoading ? "טוען את הקובץ…" : "גרור לכאן שיר או לחץ לבחירה"}</strong>
        <span>{hint ?? "MP3, WAV, OGG, FLAC, M4A, AAC · עד 150MB"}</span>
        <input
          className="native-file-input"
          type="file"
          accept=".mp3,.wav,.ogg,.flac,.m4a,.aac,.opus,.webm,audio/*,video/*"
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
