import {
  AudioLines,
  AudioWaveform,
  Check,
  ChevronLeft,
  Copy,
  Download,
  FileMusic,
  Image,
  ListMusic,
  ListMusic as ListIcon,
  Pause,
  Play,
  Printer,
  Repeat,
  RotateCcw,
  Settings2,
  Square,
  Volume2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { PianoRoll } from "../components/PianoRoll";
import { SheetMusic, printSheet, sheetToSvg } from "../components/SheetMusic";
import { Waveform } from "../components/Waveform";
import {
  buildPeaks,
  formatTime,
  isAudioSupported,
  prepareForModel,
  type TrimRange,
} from "../lib/audio";
import { scoreToAbc } from "../lib/abc";
import { useAuth } from "../lib/auth";
import { downloadFile, notesToCsv, notesToMidi, safeFilename } from "../lib/export";
import { detectKey, keyName, scientificName } from "../lib/key";
import { saveTranscription } from "../lib/history";
import { saveWork } from "../lib/works";
import { scoreToMusicXml } from "../lib/musicxml";
import { DEFAULT_REFINE, noteSpan, refineNotes } from "../lib/refine";
import { buildScore } from "../lib/score";
import { INSTRUMENTS, NotePlayer, type Instrument } from "../lib/synth";
import { moveTabFocus } from "../lib/tablist";
import { alignOffset, estimateTempo } from "../lib/tempo";
import type { DetectedNote } from "../lib/types";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useTranscriber } from "../lib/useTranscriber";
import {
  loadSettings,
  saveSettings,
  type PendingTranscription,
  type Settings,
} from "./settings";

type Tab = "sheet" | "piano" | "notes";

type Props = {
  /**
   * A history entry the shell asked this tool to open. The shell remounts the
   * tool whenever it changes, so this is read once as the starting state
   * rather than synchronised on every render.
   */
  initial: PendingTranscription | null;
};

/** "3.4 שניות" / "2:05 דקות" — the run time, in words a person reads. */
function formatDuration(milliseconds: number) {
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} שניות`;
  return `${formatTime(seconds)} דקות`;
}

export function TranscriberTool({ initial }: Props) {
  const { user } = useAuth();
  const audioFile = useAudioFile();
  const { audio } = audioFile;

  const [historyTitle, setHistoryTitle] = useState<string | null>(initial?.title ?? null);
  const [trim, setTrim] = useState<TrimRange>(null);
  const [notice, setNotice] = useState<string | null>(
    initial ? "פתחת תוצאה שמורה. קובץ השמע המקורי לא נשמר מטעמי פרטיות." : null,
  );
  const [error, setError] = useState<string | null>(null);

  const [rawNotes, setRawNotes] = useState<DetectedNote[]>(initial?.notes ?? []);
  const [analysisOffset, setAnalysisOffset] = useState(initial?.analysisOffset ?? 0);
  const [settings, setSettings] = useState<Settings>(() => initial?.settings ?? loadSettings());
  const [bpmOverride, setBpmOverride] = useState(0);
  const [bpmDraft, setBpmDraft] = useState("");

  const [elapsed, setElapsed] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("sheet");
  const [zoom, setZoom] = useState(70);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [instrument, setInstrument] = useState<Instrument>("piano");
  const [volume, setVolume] = useState(0.85);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [withClick, setWithClick] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [copied, setCopied] = useState(false);

  // The audio is downmixed and resampled before the model sees it, and on a
  // long file that takes long enough for a second click to land. The flag
  // shows the progress panel from the first click; the ref blocks a re-entry
  // that React state, which has not flushed yet, would let through.
  const [isStarting, setIsStarting] = useState(false);
  const startingRef = useRef(false);
  // Bumped whenever a run is abandoned, so work already in flight knows to
  // drop its result instead of applying it to whatever is on screen now.
  const runTokenRef = useRef(0);

  const resultsRef = useRef<HTMLElement>(null);
  const sheetSvgRef = useRef<SVGSVGElement | null>(null);
  const playerRef = useRef<NotePlayer | null>(null);

  const transcriber = useTranscriber();
  const cancelTranscription = transcriber.cancel;

  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    if (!transcriber.isRunning) return;
    // The counter is zeroed where the run starts, so the effect only ticks.
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedAt) / 1000),
      250,
    );
    return () => window.clearInterval(timer);
  }, [transcriber.isRunning]);

  // ---- everything below is derived, so no control ever costs another
  // ---- inference pass ----

  const refineOptions = useMemo(
    () => ({
      ...DEFAULT_REFINE,
      // A high sensitivity keeps quieter notes; a low one keeps only the
      // notes the model was most certain about.
      minConfidence: (1 - settings.sensitivity / 100) * 0.62,
      harmonicCleanup: settings.harmonicCleanup,
      minDuration: settings.minDuration,
      mode: settings.mode,
    }),
    [settings.sensitivity, settings.harmonicCleanup, settings.minDuration, settings.mode],
  );

  const notes = useMemo(() => refineNotes(rawNotes, refineOptions), [rawNotes, refineOptions]);

  const detectedTempo = useMemo(() => estimateTempo(notes), [notes]);
  const tempo = useMemo(() => {
    if (!bpmOverride) return detectedTempo;
    return { bpm: bpmOverride, offset: alignOffset(notes, bpmOverride), fit: detectedTempo.fit };
  }, [bpmOverride, detectedTempo, notes]);

  const keySignature = useMemo(() => detectKey(notes), [notes]);
  const title = audio
    ? audio.file.name.replace(/\.[^/.]+$/, "")
    : historyTitle ?? "SongToNotes";

  const score = useMemo(
    () =>
      buildScore(notes, {
        title,
        tempo,
        meter: { beats: settings.beatsPerMeasure, beatType: 4 },
        stepsPerBeat: settings.stepsPerBeat,
        mode: settings.mode,
        transpose: settings.transpose,
        key: keySignature,
      }),
    [
      notes,
      title,
      tempo,
      settings.beatsPerMeasure,
      settings.stepsPerBeat,
      settings.mode,
      settings.transpose,
      keySignature,
    ],
  );

  const abc = useMemo(
    () => scoreToAbc(score, { withChords: settings.withChords }),
    [score, settings.withChords],
  );

  const duration = useMemo(() => noteSpan(notes), [notes]);
  const peaks = useMemo(() => (audio ? buildPeaks(audio.buffer) : null), [audio]);

  // ---- playback ----

  useEffect(() => {
    const player = new NotePlayer();
    player.setHandlers({
      onEnd: () => {
        setIsPlaying(false);
        setPlayhead(0);
      },
    });
    playerRef.current = player;
    return () => player.dispose();
  }, []);

  useEffect(() => {
    playerRef.current?.load(notes, settings.transpose);
  }, [notes, settings.transpose]);

  useEffect(() => {
    playerRef.current?.setInstrument(instrument);
  }, [instrument]);

  useEffect(() => {
    playerRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    playerRef.current?.setRate(playbackRate);
  }, [playbackRate]);

  useEffect(() => {
    playerRef.current?.setClick(
      withClick
        ? { bpm: tempo.bpm, offset: tempo.offset, beatsPerMeasure: settings.beatsPerMeasure }
        : null,
    );
  }, [settings.beatsPerMeasure, tempo.bpm, tempo.offset, withClick]);

  // The loop region is the waveform selection expressed in note time: the
  // model's output starts at zero, while the selection is in file time.
  const loopRegion = useMemo(() => {
    if (!loopEnabled || !trim) return null;
    return {
      start: Math.max(0, trim.start - analysisOffset),
      end: Math.max(0.2, trim.end - analysisOffset),
    };
  }, [analysisOffset, loopEnabled, trim]);

  useEffect(() => {
    playerRef.current?.setLoop(loopRegion);
  }, [loopRegion]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const tick = () => {
      const player = playerRef.current;
      if (player) setPlayhead(player.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  const togglePlayback = useCallback(async () => {
    const player = playerRef.current;
    if (!player || !notes.length) return;
    if (player.isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      await player.play();
      setIsPlaying(true);
    }
  }, [notes.length]);

  const stopPlayback = useCallback(() => {
    playerRef.current?.stop(true);
    setIsPlaying(false);
    setPlayhead(0);
  }, []);

  const seek = useCallback((time: number) => {
    playerRef.current?.seek(time);
    setPlayhead(time);
  }, []);

  const hasResults = notes.length > 0;

  useEffect(() => {
    if (!hasResults) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        void togglePlayback();
      } else if (event.key === "ArrowLeft") {
        seek(Math.min(duration, (playerRef.current?.currentTime ?? 0) + 2));
      } else if (event.key === "ArrowRight") {
        seek(Math.max(0, (playerRef.current?.currentTime ?? 0) - 2));
      } else if (event.key === "Escape") {
        stopPlayback();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration, hasResults, seek, stopPlayback, togglePlayback]);

  // ---- loading audio ----

  const pickFile = useCallback(
    (candidate?: File | null) => {
      if (!candidate) return;
      runTokenRef.current += 1;
      setError(null);
      setNotice(null);
      setRawNotes([]);
      setTrim(null);
      setBpmOverride(0);
      setBpmDraft("");
      setHistoryTitle(null);
      void audioFile.load(candidate);
    },
    [audioFile],
  );

  const loadDemo = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}demo.wav`);
      if (!response.ok) throw new Error("הקובץ אינו זמין.");
      const blob = await response.blob();
      pickFile(new File([blob], "דוגמה.wav", { type: "audio/wav" }));
      setNotice("נטענה מנגינת דוגמה. לחץ על הכפתור כדי להפוך אותה לתווים.");
    } catch {
      setError("לא הצלחנו לטעון את קובץ הדוגמה.");
    }
  }, [pickFile]);

  // ---- analysis ----

  const startTranscription = useCallback(async () => {
    if (!audio || transcriber.isRunning || startingRef.current) return;
    startingRef.current = true;
    setIsStarting(true);
    const token = runTokenRef.current;
    setError(null);
    setNotice(null);
    setElapsed(0);
    stopPlayback();
    try {
      const info = await prepareForModel(audio.buffer, trim);
      if (runTokenRef.current !== token) return;
      setAnalysisOffset(info.startOffset);
      const detected = await transcriber.transcribe(info.samples, {
        engine: settings.engine,
        mode: settings.mode,
      });
      if (runTokenRef.current !== token) return;
      if (!detected.length) {
        setError(
          "לא נמצאו תווים ברורים. נסה קטע עם כלי אחד או שירה נקייה, או העלה את הרגישות.",
        );
        return;
      }
      setRawNotes(detected);
      // The result is kept either way: in the profile's own table with an
      // account, and on this device without one — where it waits in the
      // personal area and is uploaded on the first sign-in.
      const refined = refineNotes(detected, refineOptions);
      const savedTempo = estimateTempo(refined);
      const savedKey = detectKey(refined);
      const keep = user
        ? saveTranscription({
            user_id: user.id,
            title,
            source_name: audio.file.name,
            note_count: refined.length,
            duration_seconds: noteSpan(refined),
            bpm: savedTempo.bpm,
            key_name: keyName(savedKey),
            analysis_offset: info.startOffset,
            raw_notes: detected,
            settings,
          }).then(() => "התוצאה נשמרה אוטומטית באזור האישי שלך.")
        : saveWork({
            kind: "notes",
            title,
            sourceName: audio.file.name,
            summary: {
              noteCount: refined.length,
              duration: noteSpan(refined),
              bpm: savedTempo.bpm,
              keyName: keyName(savedKey),
            },
            payload: { notes: detected, analysisOffset: info.startOffset, settings },
          }).then(() => "התוצאה נשמרה במכשיר הזה. התחבר כדי לראות אותה בכל מכשיר.");
      void keep
        .then((message) => {
          if (runTokenRef.current === token) setNotice(message);
        })
        .catch(() => {
          if (runTokenRef.current === token) {
            setNotice("התווים מוכנים, אבל לא הצלחנו לשמור אותם בהיסטוריה.");
          }
        });
      window.setTimeout(
        () => resultsRef.current?.scrollIntoView({ behavior: "smooth" }),
        120,
      );
    } catch (caughtError) {
      if (runTokenRef.current !== token) return;
      const message = caughtError instanceof Error ? caughtError.message : "אירעה שגיאה.";
      if (message !== "הניתוח בוטל.") setError(message);
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  }, [audio, refineOptions, settings, stopPlayback, title, transcriber, trim, user]);

  // Melody and chords are two different readings of the audio rather than two
  // filters over one result, and so is the choice of engine. Now that a pass
  // costs seconds rather than minutes, flipping either simply re-runs it, and
  // the promise that every control updates the page still holds.
  const analysedWithRef = useRef<string | null>(null);
  useEffect(() => {
    const signature = `${settings.mode}-${settings.engine}`;
    if (!rawNotes.length) {
      if (!transcriber.isRunning && !isStarting) analysedWithRef.current = null;
      return;
    }
    if (analysedWithRef.current === null) {
      analysedWithRef.current = signature;
      return;
    }
    if (analysedWithRef.current === signature) return;
    analysedWithRef.current = signature;
    void startTranscription();
  }, [
    isStarting,
    rawNotes.length,
    settings.engine,
    settings.mode,
    startTranscription,
    transcriber.isRunning,
  ]);

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    cancelTranscription();
    stopPlayback();
    audioFile.clear();
    setHistoryTitle(null);
    setRawNotes([]);
    setTrim(null);
    setError(null);
    setNotice(null);
    setBpmOverride(0);
    setBpmDraft("");
    setLoopEnabled(false);
  }, [audioFile, cancelTranscription, stopPlayback]);

  // A history entry arrives already in state; all that is left is to bring it
  // into view once the results have rendered.
  useEffect(() => {
    if (!initial) return;
    const timer = window.setTimeout(
      () => resultsRef.current?.scrollIntoView({ behavior: "smooth" }),
      100,
    );
    return () => window.clearTimeout(timer);
  }, [initial]);

  // ---- downloads ----

  function download(kind: "midi" | "musicxml" | "abc" | "csv" | "svg") {
    const base = safeFilename(title);
    if (kind === "midi") {
      downloadFile(
        notesToMidi(notes, {
          bpm: tempo.bpm,
          quantized: true,
          offset: tempo.offset,
          stepsPerBeat: settings.stepsPerBeat,
          transpose: settings.transpose,
        }),
        `${base}.mid`,
        "audio/midi",
      );
    } else if (kind === "musicxml") {
      downloadFile(
        scoreToMusicXml(score),
        `${base}.musicxml`,
        "application/vnd.recordare.musicxml+xml;charset=utf-8",
      );
    } else if (kind === "abc") {
      downloadFile(abc, `${base}.abc`, "text/vnd.abc;charset=utf-8");
    } else if (kind === "csv") {
      downloadFile(
        notesToCsv(notes, keySignature, settings.transpose),
        `${base}.csv`,
        "text/csv;charset=utf-8",
      );
    } else {
      const svg = sheetToSvg(sheetSvgRef.current);
      if (!svg) {
        setError("התווים עדיין לא הוצגו. פתח את לשונית התווים ונסה שוב.");
        return;
      }
      downloadFile(svg, `${base}.svg`, "image/svg+xml;charset=utf-8");
    }
  }

  const copyAbc = async () => {
    try {
      await navigator.clipboard.writeText(abc);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("הדפדפן לא איפשר העתקה. אפשר להוריד את קובץ ה־ABC במקום.");
    }
  };

  const update = useCallback(
    <K extends keyof Settings>(field: K, value: Settings[K]) => {
      setSettings((previous) => ({ ...previous, [field]: value }));
    },
    [],
  );

  useAssistantTool("notes", {
    state: () =>
      `${[
        `שיר לתווים: ${audio ? `הקובץ „${audio.file.name}” (${formatTime(audio.buffer.duration)})` : historyTitle ? `תוצאה שמורה „${historyTitle}” בלי קובץ השמע` : "לא נבחר קובץ (רק הגולש בוחר קובץ או מקליט; notes.demo טוען מנגינת דוגמה)"}${trim ? `, קטע מסומן ${formatTime(trim.start)}–${formatTime(trim.end)}` : ""}`,
        `הגדרות: ${settings.mode === "melody" ? "מנגינה ראשית" : "כל התווים"}, מנוע ${settings.engine === "fast" ? "מהיר" : "מעמיק"}, רגישות ${settings.sensitivity}%, ניקוי הרמוניות ${Math.round(settings.harmonicCleanup * 100)}%, חלוקה ${settings.stepsPerBeat}, משקל ${settings.beatsPerMeasure}/4, טרנספוזיציה ${settings.transpose}`,
        transcriber.isRunning || isStarting
          ? `מנתח עכשיו (${transcriber.progress}%)`
          : hasResults
            ? `תוצאה: ${notes.length} תווים, ${Math.round(tempo.bpm)} BPM${bpmOverride ? " (ידני)" : ""}, סולם ${keyName(keySignature)}, ${formatTime(duration)}, ${score.measureCount} תיבות; תצוגה ${activeTab}; נגינה ${isPlaying ? "פועלת" : "עצורה"}, כלי ${instrument}`
            : "אין תוצאה עדיין",
      ].join("; ")}.`,
    handlers: {
      "notes.read": ({ limit }) => {
        if (!hasResults) return { ok: false, message: "אין תווים עדיין" };
        const count = Math.max(1, Math.min(400, typeof limit === "number" ? Math.round(limit) : 60));
        return {
          ok: true,
          message: `${notes.length} תווים, ${Math.round(tempo.bpm)} BPM, ${keyName(keySignature)}`,
          data: {
            count: notes.length,
            bpm: Math.round(tempo.bpm),
            key: keyName(keySignature),
            duration: Number(duration.toFixed(1)),
            measures: score.measureCount,
            notes: notes.slice(0, count).map((note) => ({ note: scientificName(note.midi + settings.transpose, keySignature.fifths), start: Number((note.start + analysisOffset).toFixed(2)), duration: Number(note.duration.toFixed(2)) })),
            abc: abc.slice(0, 2000),
          },
        };
      },
      "notes.demo": async () => {
        await loadDemo();
        return { ok: true, message: "מנגינת הדוגמה נטענה; notes.run מנתח אותה" };
      },
      "notes.run": () => {
        if (!audio) return { ok: false, message: "אין קובץ; הגולש צריך לבחור שיר או להקליט (או notes.demo)" };
        if (transcriber.isRunning || isStarting) return { ok: false, message: "כבר מנתח" };
        void startTranscription();
        return { ok: true, message: "הניתוח התחיל ורץ ברקע; התוצאה תופיע על המסך" };
      },
      "notes.set": ({ mode, engine, sensitivity, harmonicCleanup, minDuration, stepsPerBeat, beatsPerMeasure, transpose, withChords, bpm }) => {
        const done: string[] = [];
        if (mode === "melody" || mode === "full") {
          update("mode", mode);
          done.push(mode === "melody" ? "מנגינה ראשית" : "כל התווים");
        }
        if (engine === "fast" || engine === "deep") {
          update("engine", engine);
          done.push(engine === "fast" ? "מנוע מהיר" : "מנוע מעמיק");
        }
        if (typeof sensitivity === "number") {
          const clamped = Math.max(20, Math.min(90, Math.round(sensitivity)));
          update("sensitivity", clamped);
          done.push(`רגישות ${clamped}%`);
        }
        if (typeof harmonicCleanup === "number") {
          const clamped = Math.max(0, Math.min(1, harmonicCleanup > 1 ? harmonicCleanup / 100 : harmonicCleanup));
          update("harmonicCleanup", clamped);
          done.push(`ניקוי הרמוניות ${Math.round(clamped * 100)}%`);
        }
        if (typeof minDuration === "number") {
          const clamped = Math.max(0.02, Math.min(0.3, minDuration >= 1 ? minDuration / 1000 : minDuration));
          update("minDuration", clamped);
          done.push(`אורך תו מזערי ${Math.round(clamped * 1000)} מ״ש`);
        }
        if (typeof stepsPerBeat === "number") {
          if (![1, 2, 3, 4, 8].includes(stepsPerBeat)) return { ok: false, message: "stepsPerBeat הוא 1, 2, 3, 4 או 8" };
          update("stepsPerBeat", stepsPerBeat);
          done.push(`חלוקה ${stepsPerBeat}`);
        }
        if (typeof beatsPerMeasure === "number") {
          if (![2, 3, 4, 6].includes(beatsPerMeasure)) return { ok: false, message: "beatsPerMeasure הוא 2, 3, 4 או 6" };
          update("beatsPerMeasure", beatsPerMeasure);
          done.push(`משקל ${beatsPerMeasure}/4`);
        }
        if (typeof transpose === "number") {
          const clamped = Math.max(-12, Math.min(12, Math.round(transpose)));
          update("transpose", clamped);
          done.push(`טרנספוזיציה ${clamped}`);
        }
        if (typeof withChords === "boolean") {
          update("withChords", withChords);
          done.push(withChords ? "עם אקורדים" : "בלי אקורדים");
        }
        if (typeof bpm === "number") {
          if (bpm <= 0) {
            setBpmOverride(0);
            done.push("קצב אוטומטי");
          } else {
            const clamped = Math.max(40, Math.min(240, Math.round(bpm)));
            setBpmOverride(clamped);
            done.push(`${clamped} BPM`);
          }
          setBpmDraft("");
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "notes.transport": async ({ command }) => {
        if (!hasResults) return { ok: false, message: "אין תווים לנגן" };
        if (command === "play") {
          if (!isPlaying) await togglePlayback();
          return { ok: true, message: "מנגן את התווים" };
        }
        if (command === "pause") {
          if (isPlaying) await togglePlayback();
          return { ok: true, message: "הנגינה מושהית" };
        }
        stopPlayback();
        return { ok: true, message: "הנגינה נעצרה" };
      },
      "notes.playback": ({ instrument: nextInstrument, rate, volume: nextVolume, click, loop }) => {
        const done: string[] = [];
        if (typeof nextInstrument === "string") {
          const found = INSTRUMENTS.find((item) => item.id === nextInstrument);
          if (!found) return { ok: false, message: `אין כלי כזה; יש: ${INSTRUMENTS.map((item) => item.id).join(", ")}` };
          setInstrument(found.id);
          done.push(found.label);
        }
        if (typeof rate === "number") {
          const clamped = Math.max(0.5, Math.min(1.5, rate));
          setPlaybackRate(clamped);
          done.push(`מהירות ${Math.round(clamped * 100)}%`);
        }
        if (typeof nextVolume === "number") {
          setVolume(Math.max(0, Math.min(1, nextVolume / 100)));
          done.push(`עוצמה ${Math.round(nextVolume)}%`);
        }
        if (typeof click === "boolean") {
          setWithClick(click);
          done.push(click ? "מטרונום פועל" : "מטרונום כבוי");
        }
        if (typeof loop === "boolean") {
          if (loop && !trim) return { ok: false, message: "ללולאה צריך קטע מסומן בגל הקול; רק הגולש מסמן אותו" };
          setLoopEnabled(loop);
          done.push(loop ? "לולאה פועלת" : "לולאה כבויה");
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "notes.tab": ({ tab }) => {
        if (!hasResults) return { ok: false, message: "אין תוצאה להציג" };
        setActiveTab(tab as Tab);
        return { ok: true, message: tab === "sheet" ? "מוצגים התווים" : tab === "piano" ? "מוצג ה־Piano Roll" : "מוצגת רשימת התווים" };
      },
      "notes.download": ({ format }) => {
        if (!hasResults) return { ok: false, message: "אין תוצאה להורדה" };
        if (format === "print") {
          printSheet(sheetSvgRef.current, title);
          return { ok: true, message: "חלון ההדפסה נפתח" };
        }
        if (format === "svg" && !sheetSvgRef.current) return { ok: false, message: "לתמונת התווים צריך שלשונית התווים תהיה פתוחה (notes.tab sheet) ואז לנסות שוב" };
        download(format as "midi" | "musicxml" | "abc" | "csv" | "svg");
        return { ok: true, message: `קובץ ${String(format).toUpperCase()} ירד` };
      },
      "notes.reset": () => {
        reset();
        return { ok: true, message: "הקובץ והתוצאה נוקו; אפשר לבחור שיר חדש" };
      },
    },
  });

  const supported = isAudioSupported();
  const combinedError = error ?? audioFile.error;

  return (
    <>
      <section className="tool-hero">
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />
        <div className="eyebrow">
          <FileMusic size={16} /> זיהוי תווים חכם
        </div>
        <h1>שיר לתווים</h1>
        <p>בחר שיר או הקלט מנגינה ליצירת תווים.</p>
      </section>

      <section className="workspace-section">
        <div className="workspace-card">
          <div className="workspace-heading">
            <div>
              <span className="step-number">1</span>
              <h2>בחר מקור שמע</h2>
              <p>התוצאה הטובה ביותר מתקבלת מכלי נגינה יחיד או משירה נקייה.</p>
            </div>
          </div>

          {!supported && (
            <div className="error-message" role="alert">
              הדפדפן הזה אינו תומך בעיבוד אודיו. נסה בכרום, אדג׳, ספארי או
              פיירפוקס מעודכנים.
            </div>
          )}

          <AudioPicker
            audio={audio}
            isLoading={audioFile.isLoading}
            onPick={pickFile}
            onClear={reset}
            allowRecording
          >
            {audio && (
              <audio controls src={audio.url} preload="metadata" aria-label={`השמעת ${audio.file.name}`} />
            )}
          </AudioPicker>

          {!audio && (
            <div className="source-alternatives">
              <button className="secondary-button" onClick={() => void loadDemo()} type="button">
                <Wand2 size={17} /> נסה מנגינת דוגמה
              </button>
            </div>
          )}

          {peaks && audio && (
            <Waveform
              peaks={peaks}
              duration={audio.buffer.duration}
              trim={trim}
              onTrimChange={setTrim}
            />
          )}

          <div className="settings-panel">
            <div className="settings-title">
              <Settings2 size={18} /> הגדרות זיהוי
            </div>
            <div className="settings-grid">
              <div className="setting-field">
                <span id="mode-label">מה להוציא מהשיר?</span>
                <div className="segmented-control" role="group" aria-labelledby="mode-label">
                  <button
                    className={settings.mode === "melody" ? "active" : ""}
                    onClick={() => update("mode", "melody")}
                    aria-pressed={settings.mode === "melody"}
                    type="button"
                  >
                    מנגינה ראשית
                  </button>
                  <button
                    className={settings.mode === "full" ? "active" : ""}
                    onClick={() => update("mode", "full")}
                    aria-pressed={settings.mode === "full"}
                    type="button"
                  >
                    כל התווים
                  </button>
                </div>
              </div>
              <label className="setting-field range-field">
                <span>
                  רגישות לזיהוי <b>{settings.sensitivity}%</b>
                </span>
                <input
                  type="range"
                  min="20"
                  max="90"
                  value={settings.sensitivity}
                  onChange={(event) => update("sensitivity", Number(event.target.value))}
                />
                <small>
                  רגישות גבוהה כוללת גם צלילים חלשים.
                </small>
              </label>
              <div className="setting-field">
                <span id="engine-label">מנוע הזיהוי</span>
                <div className="segmented-control" role="group" aria-labelledby="engine-label">
                  <button
                    className={settings.engine === "fast" ? "active" : ""}
                    onClick={() => update("engine", "fast")}
                    aria-pressed={settings.engine === "fast"}
                    type="button"
                  >
                    מהיר
                  </button>
                  <button
                    className={settings.engine === "deep" ? "active" : ""}
                    onClick={() => update("engine", "deep")}
                    aria-pressed={settings.engine === "deep"}
                    type="button"
                  >
                    מעמיק
                  </button>
                </div>
                <small>
                  {settings.engine === "fast"
                    ? "לזיהוי מהיר."
                    : "זיהוי מעמיק עשוי להימשך כמה דקות."}
                </small>
              </div>
            </div>
          </div>

          {combinedError && (
            <div className="error-message" role="alert">
              {combinedError}
            </div>
          )}
          {notice && !combinedError && (
            <div className="notice-message" role="status">
              {notice}
            </div>
          )}

          {transcriber.isRunning || isStarting ? (
            <div className="processing-box">
              <div className="processing-top">
                <span>
                  <AudioWaveform size={20} />{" "}
                  {transcriber.isRunning ? "מנתח את הצלילים והתווים…" : "מכין את השמע לניתוח…"}
                </span>
                <strong aria-live="polite">
                  {transcriber.progress}% · {formatTime(elapsed)}
                </strong>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="התקדמות ניתוח השיר"
                aria-valuenow={transcriber.progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${transcriber.progress}%` }} />
              </div>
              <div className="processing-bottom">
                <small>
                  {settings.engine === "deep"
                    ? "מזהה תווים… זה עשוי להימשך כמה דקות."
                    : "מזהה תווים…"}
                </small>
                {transcriber.isRunning && (
                  <button className="secondary-button" onClick={transcriber.cancel} type="button">
                    בטל
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button
              className="primary-button"
              type="button"
              disabled={!audio || audioFile.isLoading || !supported}
              onClick={startTranscription}
            >
              <AudioLines size={21} />
              {trim ? "הפוך את הקטע הנבחר לתווים" : "הפוך את השיר לתווים"}
              <ChevronLeft size={20} />
            </button>
          )}
        </div>
      </section>

      {hasResults && (
        <section className="results-section" ref={resultsRef}>
          <div className="results-header">
            <div>
              <div className="eyebrow">
                <Check size={16} /> הניתוח הושלם
              </div>
              <h2>התווים של „{title}”</h2>
            </div>
            <button className="secondary-button" onClick={reset} type="button">
              <RotateCcw size={17} /> שיר חדש
            </button>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <strong>{notes.length.toLocaleString("he-IL")}</strong>
              <span>תווים בתצוגה</span>
            </div>
            <div className="stat-card">
              <strong>{Math.round(tempo.bpm)}</strong>
              <span>BPM {bpmOverride ? "ידני" : "משוער"}</span>
            </div>
            <div className="stat-card">
              <strong>{keyName(keySignature)}</strong>
              <span>סולם משוער</span>
            </div>
            <div className="stat-card">
              <strong>{formatTime(duration)}</strong>
              <span>משך שנותח</span>
            </div>
            <div className="stat-card">
              <strong>{score.measureCount}</strong>
              <span>תיבות</span>
            </div>
          </div>

          {transcriber.elapsed !== null && (
            <p className="engine-note">
              {transcriber.engine === "deep"
                ? `הזיהוי המעמיק הסתיים ב־${formatDuration(transcriber.elapsed)}.`
                : `הזיהוי המהיר הסתיים ב־${formatDuration(transcriber.elapsed)}.`}
            </p>
          )}

          <div className="playback-card">
            <div className="transport">
              <button
                className="transport-button primary"
                onClick={togglePlayback}
                type="button"
                aria-label={isPlaying ? "השהה" : "נגן את התווים שזוהו"}
              >
                {isPlaying ? <Pause size={19} /> : <Play size={19} />}
                {isPlaying ? "השהה" : "נגן את התוצאה"}
              </button>
              <button className="transport-button" onClick={stopPlayback} type="button" aria-label="עצור">
                <Square size={16} />
              </button>
              <input
                className="transport-seek"
                type="range"
                min={0}
                max={Math.max(0.1, duration)}
                step={0.01}
                value={Math.min(playhead, duration)}
                onChange={(event) => seek(Number(event.target.value))}
                aria-label="מיקום הנגינה"
              />
              <span className="transport-time">
                {formatTime(playhead)} / {formatTime(duration)}
              </span>
            </div>

            <div className="playback-options">
              <label className="playback-field">
                <span>כלי נגינה</span>
                <select
                  value={instrument}
                  onChange={(event) => setInstrument(event.target.value as Instrument)}
                >
                  {INSTRUMENTS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="playback-field">
                <span>מהירות</span>
                <select
                  value={playbackRate}
                  onChange={(event) => setPlaybackRate(Number(event.target.value))}
                >
                  {[0.5, 0.75, 1, 1.25, 1.5].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate === 1 ? "רגילה" : `${Math.round(rate * 100)}%`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="playback-field slider">
                <span>
                  <Volume2 size={14} /> עוצמה
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(volume * 100)}
                  onChange={(event) => setVolume(Number(event.target.value) / 100)}
                />
              </label>
              <button
                className={`chip-toggle ${withClick ? "active" : ""}`}
                type="button"
                onClick={() => setWithClick((value) => !value)}
                aria-pressed={withClick}
              >
                <ListIcon size={15} /> מטרונום
              </button>
              <button
                className={`chip-toggle ${loopEnabled ? "active" : ""}`}
                type="button"
                disabled={!trim}
                title={trim ? undefined : "סמן קטע בגל הקול כדי להפעיל לולאה"}
                onClick={() => setLoopEnabled((value) => !value)}
                aria-pressed={loopEnabled}
              >
                <Repeat size={15} /> לולאה
              </button>
            </div>
            <small className="shortcut-hint">
              קיצורים: רווח = נגן/השהה · חצים = דילוג · Esc = עצירה
            </small>
          </div>

          <div className="refine-panel">
            <div className="settings-title">
              <Wand2 size={18} /> כוונון התוצאה
              <em>השינויים מתעדכנים מיד</em>
            </div>
            <div className="refine-grid">
              <label className="setting-field range-field">
                <span>
                  ניקוי הרמוניות <b>{Math.round(settings.harmonicCleanup * 100)}%</b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(settings.harmonicCleanup * 100)}
                  onChange={(event) => update("harmonicCleanup", Number(event.target.value) / 100)}
                />
                <small>מסיר צלילים עליונים שנוצרים מאותו תו.</small>
              </label>

              <label className="setting-field range-field">
                <span>
                  אורך תו מזערי <b>{Math.round(settings.minDuration * 1000)} מ״ש</b>
                </span>
                <input
                  type="range"
                  min="20"
                  max="300"
                  step="10"
                  value={Math.round(settings.minDuration * 1000)}
                  onChange={(event) => update("minDuration", Number(event.target.value) / 1000)}
                />
                <small>מסנן נקישות ורעשים קצרים.</small>
              </label>

              <label className="setting-field">
                <span>חלוקת התווים</span>
                <select
                  value={settings.stepsPerBeat}
                  onChange={(event) => update("stepsPerBeat", Number(event.target.value))}
                >
                  <option value={1}>רבעים</option>
                  <option value={2}>שמיניות</option>
                  <option value={3}>טריולות</option>
                  <option value={4}>שש־עשרוניות</option>
                  <option value={8}>חלקי שלושים ושתיים</option>
                </select>
                <small>רשת עדינה שומרת פרטים, גסה יותר קלה לקריאה.</small>
              </label>

              <label className="setting-field">
                <span>משקל</span>
                <select
                  value={settings.beatsPerMeasure}
                  onChange={(event) => update("beatsPerMeasure", Number(event.target.value))}
                >
                  <option value={4}>4/4</option>
                  <option value={3}>3/4</option>
                  <option value={2}>2/4</option>
                  <option value={6}>6/4</option>
                </select>
              </label>

              <label className="setting-field">
                <span>קצב (BPM)</span>
                <div className="tempo-row">
                  <input
                    type="number"
                    min="40"
                    max="240"
                    value={bpmDraft || Math.round(tempo.bpm)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setBpmDraft(raw);
                      const parsed = Number(raw);
                      if (parsed >= 40 && parsed <= 240) setBpmOverride(parsed);
                    }}
                    onBlur={() => setBpmDraft("")}
                  />
                  {bpmOverride > 0 && (
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => {
                        setBpmOverride(0);
                        setBpmDraft("");
                      }}
                    >
                      חזרה לזיהוי אוטומטי
                    </button>
                  )}
                </div>
              </label>

              <label className="setting-field range-field">
                <span>
                  טרנספוזיציה{" "}
                  <b>
                    {settings.transpose > 0 ? "+" : ""}
                    {settings.transpose}
                  </b>
                </span>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  value={settings.transpose}
                  onChange={(event) => update("transpose", Number(event.target.value))}
                />
                <small>הזזת כל התווים בחצאי טונים.</small>
              </label>

              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={settings.withChords}
                  onChange={(event) => update("withChords", event.target.checked)}
                />
                <span>הצג סימוני אקורדים מעל התווים</span>
              </label>
            </div>
          </div>

          <div className="result-toolbar">
            <div className="tabs" role="tablist" aria-label="תצוגות התוצאה">
              <button
                role="tab"
                id="tab-sheet"
                aria-selected={activeTab === "sheet"}
                aria-controls="panel-sheet"
                tabIndex={activeTab === "sheet" ? 0 : -1}
                onKeyDown={moveTabFocus}
                className={activeTab === "sheet" ? "active" : ""}
                onClick={() => setActiveTab("sheet")}
                type="button"
              >
                <FileMusic size={17} /> תווים
              </button>
              <button
                role="tab"
                id="tab-piano"
                aria-selected={activeTab === "piano"}
                aria-controls="panel-piano"
                tabIndex={activeTab === "piano" ? 0 : -1}
                onKeyDown={moveTabFocus}
                className={activeTab === "piano" ? "active" : ""}
                onClick={() => setActiveTab("piano")}
                type="button"
              >
                <AudioWaveform size={17} /> Piano Roll
              </button>
              <button
                role="tab"
                id="tab-notes"
                aria-selected={activeTab === "notes"}
                aria-controls="panel-notes"
                tabIndex={activeTab === "notes" ? 0 : -1}
                onKeyDown={moveTabFocus}
                className={activeTab === "notes" ? "active" : ""}
                onClick={() => setActiveTab("notes")}
                type="button"
              >
                <ListMusic size={17} /> רשימת תווים
              </button>
            </div>
            <div className="toolbar-actions">
              {activeTab === "piano" && (
                <label className="tempo-control">
                  תקריב
                  <input
                    type="range"
                    min="24"
                    max="220"
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  />
                </label>
              )}
              {activeTab === "sheet" && (
                <>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => printSheet(sheetSvgRef.current, title)}
                    aria-label="הדפס את התווים"
                    title="הדפסה / שמירה כ־PDF"
                  >
                    <Printer size={17} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => void copyAbc()}
                    aria-label="העתק קוד ABC"
                    title={copied ? "הועתק!" : "העתק קוד ABC"}
                  >
                    {copied ? <Check size={17} /> : <Copy size={17} />}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="result-canvas">
            {activeTab === "sheet" && (
              <div id="panel-sheet" role="tabpanel" aria-labelledby="tab-sheet">
                <SheetMusic
                  abc={abc}
                  onRendered={(svg) => {
                    sheetSvgRef.current = svg;
                  }}
                />
              </div>
            )}
            {activeTab === "piano" && (
              <div id="panel-piano" role="tabpanel" aria-labelledby="tab-piano">
                <PianoRoll
                  notes={notes}
                  tempo={tempo}
                  meter={{ beats: settings.beatsPerMeasure, beatType: 4 }}
                  keySignature={keySignature}
                  transpose={settings.transpose}
                  playhead={playhead}
                  zoom={zoom}
                  onSeek={seek}
                />
              </div>
            )}
            {activeTab === "notes" && (
              <div
                id="panel-notes"
                role="tabpanel"
                aria-labelledby="tab-notes"
                className="note-table-wrap"
              >
                <table className="note-table">
                  <caption className="sr-only">רשימת התווים שזוהו בשיר</caption>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>תו</th>
                      <th>MIDI</th>
                      <th>התחלה</th>
                      <th>משך</th>
                      <th>ביטחון</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.slice(0, 800).map((note, index) => {
                      const midi = note.midi + settings.transpose;
                      return (
                        <tr key={`${note.start}-${midi}-${index}`}>
                          <td>{index + 1}</td>
                          <td>{scientificName(midi, keySignature.fifths)}</td>
                          <td>{midi}</td>
                          <td>{(note.start + analysisOffset).toFixed(2)} שנ׳</td>
                          <td>{note.duration.toFixed(2)} שנ׳</td>
                          <td>{Math.round(note.confidence * 100)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {notes.length > 800 && (
                  <p className="table-footnote">
                    מוצגים 800 התווים הראשונים מתוך {notes.length.toLocaleString("he-IL")}. קובץ
                    ה־CSV מכיל את כולם.
                  </p>
                )}
              </div>
            )}
          </div>

          {score.truncated && (
            <p className="table-footnote">
              השיר ארוך מהתצוגה המרבית, והתווים נחתכו בסוף. אפשר לסמן קטע קצר
              יותר בגל הקול לקבלת תווים מלאים.
            </p>
          )}

          <div className="downloads-card">
            <div>
              <span className="download-icon">
                <Download size={23} />
              </span>
              <div>
                <h3>הורדת התוצאה</h3>
                <p>פתח בתוכנת תווים, אולפן או גיליון נתונים.</p>
              </div>
            </div>
            <div className="download-buttons">
              <button onClick={() => download("musicxml")} type="button">
                <FileMusic size={17} />
                <span>
                  MusicXML<small>MuseScore ותוכנות תווים</small>
                </span>
              </button>
              <button onClick={() => download("midi")} type="button">
                <ListMusic size={17} />
                <span>
                  MIDI<small>תוכנות אולפן ונגינה</small>
                </span>
              </button>
              <button onClick={() => download("svg")} type="button">
                <Image size={17} />
                <span>
                  תמונת תווים<small>SVG להדפסה ולשיתוף</small>
                </span>
              </button>
              <button onClick={() => printSheet(sheetSvgRef.current, title)} type="button">
                <Printer size={17} />
                <span>
                  הדפסה / PDF<small>דף תווים להדפסה</small>
                </span>
              </button>
              <button onClick={() => download("abc")} type="button">
                <FileMusic size={17} />
                <span>
                  ABC<small>קובץ תווים טקסטואלי</small>
                </span>
              </button>
              <button onClick={() => download("csv")} type="button">
                <ListMusic size={17} />
                <span>
                  CSV<small>רשימת כל התווים</small>
                </span>
              </button>
            </div>
          </div>
        </section>
      )}

    </>
  );
}
