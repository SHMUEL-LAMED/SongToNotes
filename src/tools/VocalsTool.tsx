import { Cpu, Download, Headphones, Layers, MicVocal, Sparkles, Volume2, VolumeX, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AiError, separateOnServer, separationAvailability } from "../lib/aiApi";
import { decodeAudioFile } from "../lib/audio";
import { useAuth } from "../lib/auth";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import {
  describeSeparationError,
  prefetchSeparationModel,
  separateStems,
  type SeparationProgress,
} from "../lib/stemSeparation";
import { channelsToBuffer } from "../lib/dsp";
import { downloadFile, safeFilename } from "../lib/export";
import type { SeparateTarget } from "../lib/separate";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";
import { useSeparation } from "../lib/useSeparation";
import { encodeWav } from "../lib/wav";
import { handOffTo } from "../lib/handoff";
import { MixPlayer, audibleTracks, mixDuration, renderMix, type MixTrack } from "../lib/mixer";
import type { SavedWork } from "../lib/works";

const STEM_NAMES: Record<string, string> = { vocals: "שירה", drums: "תופים", bass: "בס", other: "שאר הכלים", guitar: "גיטרה", piano: "פסנתר", no_vocals: "ליווי" };
const STEM_HUES: Record<string, number> = { vocals: 340, drums: 20, bass: 260, other: 200, guitar: 45, piano: 120 };

function sharedContext() {
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Context ? new Context() : null;
}

type Props = {
  /**
   * A saved separation the personal area asked this tool to open. The song
   * itself was never stored, so the settings are restored and the visitor is
   * asked for the file again.
   */
  initial?: SavedWork | null;
};

function readSavedStems(work: SavedWork | null | undefined) {
  const tracks = work?.payload.tracks;
  if (!Array.isArray(tracks)) return null;
  const saved: Record<string, { gain: number; pan: number; muted: boolean; solo: boolean }> = {};
  for (const item of tracks) {
    if (!item || typeof item !== "object") continue;
    const { id, gain, pan, muted, solo } = item as Record<string, unknown>;
    if (typeof id !== "string") continue;
    saved[id] = {
      gain: typeof gain === "number" ? Math.max(0, Math.min(2, gain)) : 1,
      pan: typeof pan === "number" ? Math.max(-1, Math.min(1, pan)) : 0,
      muted: muted === true,
      solo: solo === true,
    };
  }
  return Object.keys(saved).length ? saved : null;
}

function readInitial(work: SavedWork | null | undefined) {
  const payload = work?.payload ?? {};
  return {
    target: payload.target === "vocals" ? ("vocals" as const) : ("instrumental" as const),
    strength:
      typeof payload.strength === "number"
        ? Math.max(0, Math.min(100, Math.round(payload.strength)))
        : 100,
    keepBass: typeof payload.keepBass === "boolean" ? payload.keepBass : true,
  };
}

/**
 * Turns a song into a backing track, or into the voice alone.
 *
 * The fast path reads the stereo image bin by bin — see {@link ../lib/separate}
 * for why that is a different thing from subtracting one channel from the
 * other. The AI path sends the song to the site's server, where a real
 * separation network runs ({@link ../lib/aiApi}); nothing is fetched onto
 * the device. It is the only option that works on a mono recording or on a
 * mix where the singer is not centred. Until the server has a key, the same
 * network can still run in the browser, at the cost of a large download.
 */
export function VocalsTool({ initial = null }: Props) {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [restored] = useState(() => readInitial(initial));
  const [target, setTarget] = useState<SeparateTarget>(restored.target);
  const [strength, setStrength] = useState(restored.strength);
  const [keepBass, setKeepBass] = useState(restored.keepBass);
  const [compare, setCompare] = useState(false);
  const [context] = useState(sharedContext);
  const { user } = useAuth();
  const separation = useSeparation(context);
  const aiAbortRef = useRef<AbortController | null>(null);
  // `true` means the free on-device Demucs model is used. `null` is while the
  // very small availability check is still pending.
  const [serverMissing, setServerMissing] = useState<boolean | null>(null);
  // Simple: the voice or the backing track. Pro: every part the model finds,
  // each on its own fader, mixed live and rendered together.
  const [mode, setMode] = useState<"simple" | "pro">(initial?.payload.mode === "pro" ? "pro" : "simple");
  const [stems, setStems] = useState<{ key: string; tracks: MixTrack[] } | null>(null);
  const [stemsPlaying, setStemsPlaying] = useState(false);
  const [stemsRendering, setStemsRendering] = useState(false);
  const stemsPlayerRef = useRef<MixPlayer | null>(null);
  // Fader positions from a saved pro-mode work, applied once the stems are back.
  const savedStemsRef = useRef<Record<string, { gain: number; pan: number; muted: boolean; solo: boolean }> | null>(readSavedStems(initial));
  const saving = useSaveWork();
  const resetSave = saving.reset;

  // The result is stored with the settings that produced it, so a stale
  // rendering is never shown next to controls that have already moved on.
  const [rendered, setRendered] = useState<{
    key: string;
    buffer: AudioBuffer;
    wasMono: boolean;
  } | null>(null);
  const [usedAi, setUsedAi] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => () => void context?.close(), [context]);
  useEffect(() => {
    const player = new MixPlayer();
    player.onEnd = () => setStemsPlaying(false);
    stemsPlayerRef.current = player;
    return () => player.dispose();
  }, []);
  useEffect(() => {
    stemsPlayerRef.current?.setTracks(stems?.tracks ?? []);
  }, [stems]);
  useEffect(() => {
    const controller = new AbortController();
    void separationAvailability(controller.signal)
      .then(({ configured }) => setServerMissing(!configured))
      .catch(() => setServerMissing(true));
    return () => controller.abort();
  }, []);
  // The network is fetched only once the visitor has chosen the browser path:
  // it is 180MB, and the server path needs none of it.
  useEffect(() => {
    if (audio && serverMissing === true) prefetchSeparationModel();
  }, [audio, serverMissing]);

  const runFast = separation.run;
  const settingsKey = audio
    ? `${audio.url}|${target}|${strength}|${keepBass}`
    : "";

  useEffect(() => {
    if (!audio || !settingsKey) return;
    // The gap debounces a dragged slider, so passing through five values
    // still costs one separation rather than five.
    const timer = window.setTimeout(() => {
      setUsedAi(false);
      setAiStatus(null);
      void runFast(audio.buffer, {
        target,
        strength: strength / 100,
        // A voice has nothing below about 140 Hz worth keeping, and the bass
        // and kick that live down there are the last thing a backing track
        // should lose — so the band is protected when making one, and
        // discarded when isolating the singer.
        keepBelowHz: target === "instrumental" ? (keepBass ? 150 : 0) : 130,
      })
        .then((separated) =>
          setRendered({
            key: settingsKey,
            buffer: separated.buffer,
            wasMono: separated.wasMono,
          }),
        )
        .catch(() => {
          // A cancelled run belongs to settings nobody is looking at any
          // more; a failed one has already put its reason on screen.
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [audio, keepBass, runFast, settingsKey, strength, target]);

  // A change of settings is a different result, so the save button offers
  // to save again rather than still saying "נשמר" over a new rendering.
  useEffect(() => resetSave(), [resetSave, settingsKey, usedAi]);

  // An AI result is keyed to the settings that asked for it too, so the two
  // paths can hand their output to the same player and download button.
  const matches = rendered !== null && rendered.key === settingsKey;
  const result = matches ? rendered.buffer : null;
  const wasMono = matches ? rendered.wasMono : false;

  /** The server path: upload, wait, fetch the stem the visitor asked for. */
  const runAi = useCallback(async () => {
    if (!audio || !context) return;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiBusy(true);
    setAiProgress(0);
    setAiStatus("מכין את ההפרדה…");
    try {
      const availability = await separationAvailability(controller.signal);
      if (!availability.configured) {
        setServerMissing(true);
        setAiStatus("ההפרדה מתבצעת בדפדפן. בפעם הראשונה נטען מודל ההפרדה…");
        const localStems = await separateStems(audio.buffer, (progress: SeparationProgress) => {
          if (controller.signal.aborted) return;
          setAiProgress(Math.round(progress.progress * 100));
          setAiStatus(progress.message);
        });
        if (controller.signal.aborted) return;
        const localPicked = target === "instrumental" ? localStems.instrumental : localStems.vocals;
        setRendered({
          key: settingsKey,
          buffer: channelsToBuffer(context, localPicked, localStems.sampleRate),
          wasMono: false,
        });
        setUsedAi(true);
        setAiProgress(100);
        setAiStatus("הפרדת ה־AI הושלמה.");
        return;
      }

      const stems = await separateOnServer(
        audio.file,
        decodeAudioFile,
        (message, percent) => {
          if (controller.signal.aborted) return;
          setAiStatus(message);
          if (percent !== null) setAiProgress(percent);
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const picked = target === "instrumental" ? stems.instrumental : stems.vocals;
      if (!picked) throw new AiError("provider_error", "השרת לא החזיר את הערוץ המבוקש.");
      setRendered({ key: settingsKey, buffer: picked, wasMono: false });
      setUsedAi(true);
      setAiProgress(100);
      setAiStatus(`ההפרדה הושלמה בשרת. נוצלו היום ${stems.used} מתוך ${stems.limit} שירים.`);
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (caught instanceof AiError && caught.code === "not_configured") {
        setServerMissing(true);
        setAiStatus("ההפרדה בשרת עדיין לא הופעלה. אפשר להפריד בדפדפן — זה מוריד רשת של 180MB בפעם הראשונה.");
      } else {
        setAiStatus(caught instanceof Error ? caught.message : "ההפרדה נכשלה.");
      }
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
        setAiBusy(false);
      }
    }
  }, [audio, context, settingsKey, target]);

  /** Pro mode: every stem the server can give, into faders. */
  const runStems = useCallback(async () => {
    if (!audio) return;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiBusy(true);
    setAiProgress(0);
    setAiStatus("מכין הפרדה לערוצים…");
    try {
      const availability = await separationAvailability(controller.signal);
      if (!availability.configured) {
        setServerMissing(true);
        setAiStatus("הפרדה לערוצים נפרדים דורשת את השרת, שעדיין לא הופעל. במצב פשוט אפשר להפריד בדפדפן.");
        return;
      }
      const result = await separateOnServer(
        audio.file,
        decodeAudioFile,
        (message, percent) => {
          if (controller.signal.aborted) return;
          setAiStatus(message);
          if (percent !== null) setAiProgress(percent);
        },
        controller.signal,
        "stems",
      );
      if (controller.signal.aborted) return;
      const names = Object.keys(result.stems).filter((name) => name !== "no_vocals");
      if (!names.length) throw new AiError("provider_error", "השרת לא החזיר ערוצים.");
      const order = ["vocals", "drums", "bass", "guitar", "piano", "other"];
      names.sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
      const saved = savedStemsRef.current;
      savedStemsRef.current = null;
      setStems({
        key: audio.url,
        tracks: names.map((name) => ({
          id: name,
          name: STEM_NAMES[name] ?? name,
          buffer: result.stems[name],
          gain: saved?.[name]?.gain ?? 1,
          pan: saved?.[name]?.pan ?? 0,
          muted: saved?.[name]?.muted ?? false,
          solo: saved?.[name]?.solo ?? false,
          offset: 0,
          color: STEM_HUES[name] ?? 180,
        })),
      });
      setUsedAi(true);
      setAiProgress(100);
      setAiStatus(`ההפרדה הושלמה: ${names.length} ערוצים. נוצלו היום ${result.used} מתוך ${result.limit} שירים.`);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setAiStatus(caught instanceof Error ? caught.message : "ההפרדה נכשלה.");
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
        setAiBusy(false);
      }
    }
  }, [audio]);

  /** Silences the stem mix, and with `drop`, forgets it: the song it came from is gone. */
  const stopStems = (drop = false) => {
    stemsPlayerRef.current?.stop();
    setStemsPlaying(false);
    if (drop) setStems(null);
  };

  const updateStem = (id: string, patch: Partial<MixTrack>) =>
    setStems((current) => (current ? { ...current, tracks: current.tracks.map((track) => (track.id === id ? { ...track, ...patch } : track)) } : current));

  const stemFile = (track: MixTrack) => {
    const channels = Array.from({ length: track.buffer.numberOfChannels }, (_, index) => track.buffer.getChannelData(index));
    const base = safeFilename((audio?.file.name ?? "song").replace(/\.[^/.]+$/, ""));
    return new File([encodeWav({ channels, sampleRate: track.buffer.sampleRate })], `${base}-${track.id}.wav`, { type: "audio/wav" });
  };

  const renderStemMix = async () => {
    if (!stems || !audio) return null;
    setStemsRendering(true);
    try {
      const rendered = await renderMix(stems.tracks);
      const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
      const base = safeFilename(audio.file.name.replace(/\.[^/.]+$/, ""));
      return new File([encodeWav({ channels, sampleRate: rendered.sampleRate })], `${base}-mix.wav`, { type: "audio/wav" });
    } finally {
      setStemsRendering(false);
    }
  };

  const saveStems = async () => {
    const file = await renderStemMix();
    if (!file || !audio || !stems) return null;
    return saving.save(
      {
        kind: "vocals",
        title: `${audio.file.name.replace(/\.[^/.]+$/, "")} — מיקס ערוצים`,
        sourceName: audio.file.name,
        summary: { target: "mix", usedAi: true, mode: "pro", stems: stems.tracks.length, duration: mixDuration(stems.tracks) },
        payload: { mode: "pro", usedAi: true, tracks: stems.tracks.map((track) => ({ id: track.id, gain: track.gain, pan: track.pan, muted: track.muted, solo: track.solo })) },
      },
      file,
    );
  };

  /** The browser path, offered only while the server has no key. */
  const runAiInBrowser = useCallback(async () => {
    if (!audio || !context) return;
    setAiBusy(true);
    setAiProgress(0);
    setAiStatus("מכין את ההפרדה…");
    try {
      const report = (progress: SeparationProgress) => {
        setAiProgress(Math.round(progress.progress * 100));
        setAiStatus(progress.message);
      };
      const stems = await separateStems(audio.buffer, report);
      const picked = target === "instrumental" ? stems.instrumental : stems.vocals;
      setRendered({
        key: settingsKey,
        buffer: channelsToBuffer(context, picked, stems.sampleRate),
        wasMono: false,
      });
      setUsedAi(true);
      setAiProgress(100);
      setAiStatus("ההפרדה הושלמה.");
    } catch (caught) {
      setAiStatus(describeSeparationError(caught));
    } finally {
      setAiBusy(false);
    }
  }, [audio, context, settingsKey, target]);

  const buildFile = () => {
    if (!result || !audio) return null;
    const channels = Array.from(
      { length: result.numberOfChannels },
      (_, index) => result.getChannelData(index),
    );
    const blob = encodeWav({ channels, sampleRate: result.sampleRate });
    const base = safeFilename(audio.file.name.replace(/\.[^/.]+$/, ""));
    return new File(
      [blob],
      `${base}-${target === "instrumental" ? "karaoke" : "vocals"}.wav`,
      { type: "audio/wav" },
    );
  };

  const exportWav = () => {
    const file = buildFile();
    if (!file) return;
    downloadFile(file, file.name, "audio/wav");
  };

  const saveToProfile = () => {
    const file = buildFile();
    if (!file || !audio || !result) return Promise.resolve(null);
    const base = audio.file.name.replace(/\.[^/.]+$/, "");
    return saving.save(
      {
        kind: "vocals",
        title: `${base} — ${target === "instrumental" ? "קריוקי" : "שירה בלבד"}`,
        sourceName: audio.file.name,
        summary: {
          target,
          strength,
          keepBass,
          usedAi,
          duration: result.duration,
          mono: wasMono,
        },
        payload: { target, strength, keepBass, usedAi },
      },
      file,
    );
  };

  const isMono = audio ? audio.buffer.numberOfChannels < 2 : false;
  // The separator falls back to WebAssembly where WebGPU is missing and
  // resamples the song itself, so there is nothing left to gate on.
  const busy = separation.isRunning || aiBusy;

  const stemsReady = Boolean(stems && audio && stems.key === audio.url);
  useAssistantTool("vocals", {
    state: () =>
      `הסרת שירה: ${audio ? `השיר „${audio.file.name}” (${audio.buffer.numberOfChannels === 1 ? "מונו" : "סטריאו"})` : "לא נבחר שיר (רק הגולש בוחר קובץ)"}; מצב ${mode === "simple" ? "פשוט" : "מקצועי"}; ${
        mode === "simple"
          ? `להשאיר: ${target === "instrumental" ? "ליווי בלבד (קריוקי)" : "שירה בלבד"}, עוצמת הפרדה ${strength}%${target === "instrumental" ? `, שמירת בס ${keepBass ? "פועלת" : "כבויה"}` : ""}${result ? (usedAi ? "; יש תוצאת AI" : "; יש תוצאה מהירה לפי תמונת הסטריאו") : ""}`
          : stemsReady && stems
            ? `ערוצים: ${stems.tracks.map((track) => `${track.id} (${track.name}) ${Math.round(track.gain * 100)}%${track.muted ? " מושתק" : ""}${track.solo ? " סולו" : ""}`).join(", ")}`
            : "עדיין לא הופרד לערוצים"
      }${busy ? "; עובד עכשיו" : ""}${aiStatus ? `; סטטוס: ${aiStatus}` : ""}${serverMissing === true ? "; ההפרדה בשרת לא הופעלה, הפרדת AI תרוץ בדפדפן" : ""}${!user ? "; הגולש לא מחובר (הפרדה בשרת דורשת חשבון)" : ""}.`,
    handlers: {
      "vocals.read": () => ({
        ok: true,
        message: audio ? (result ? "יש תוצאה" : "אין תוצאה עדיין") : "אין שיר",
        data: {
          file: audio?.file.name ?? null,
          mode,
          target,
          strength,
          keepBass,
          hasResult: Boolean(result),
          usedAi,
          stems: stemsReady && stems ? stems.tracks.map((track) => ({ name: track.id, label: track.name, gain: Math.round(track.gain * 100), pan: Math.round(track.pan * 100), muted: track.muted, solo: track.solo })) : null,
          busy,
          status: aiStatus,
        },
      }),
      "vocals.set": ({ mode: nextMode, target: nextTarget, strength: nextStrength, keepBass: nextKeepBass, compare: nextCompare }) => {
        if (!audio) return { ok: false, message: "אין שיר; הגולש צריך לבחור קובץ" };
        const done: string[] = [];
        if (nextMode === "simple" || nextMode === "pro") {
          if (busy) return { ok: false, message: "עובד כרגע; אפשר לשנות מצב כשההפרדה תסתיים" };
          if (nextMode === "simple") stopStems();
          setMode(nextMode);
          done.push(nextMode === "simple" ? "מצב פשוט" : "מצב מקצועי");
        }
        if (nextTarget === "instrumental" || nextTarget === "vocals") {
          setTarget(nextTarget);
          done.push(nextTarget === "instrumental" ? "ליווי בלבד (קריוקי)" : "שירה בלבד");
        }
        if (typeof nextStrength === "number") {
          const clamped = Math.max(0, Math.min(100, Math.round(nextStrength)));
          setStrength(clamped);
          done.push(`עוצמת הפרדה ${clamped}%`);
        }
        if (typeof nextKeepBass === "boolean") {
          setKeepBass(nextKeepBass);
          done.push(nextKeepBass ? "שמירת בס פועלת" : "שמירת בס כבויה");
        }
        if (typeof nextCompare === "boolean") {
          setCompare(nextCompare);
          done.push(nextCompare ? "השוואה למקור" : "בלי השוואה למקור");
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "vocals.ai": () => {
        if (!audio) return { ok: false, message: "אין שיר; הגולש צריך לבחור קובץ" };
        if (busy) return { ok: false, message: "כבר עובד" };
        if (mode !== "simple") setMode("simple");
        void runAi();
        return { ok: true, message: "הפרדת ה־AI התחילה ורצה ברקע (כדקה); ההתקדמות מוצגת על המסך" };
      },
      "vocals.stems": () => {
        if (!audio) return { ok: false, message: "אין שיר; הגולש צריך לבחור קובץ" };
        if (busy) return { ok: false, message: "כבר עובד" };
        if (!user) return { ok: false, message: "הפרדה לערוצים דורשת חשבון מחובר" };
        if (mode !== "pro") setMode("pro");
        void runStems();
        return { ok: true, message: "ההפרדה לערוצים התחילה ורצה ברקע (כדקה)" };
      },
      "vocals.stem": ({ name, gain, pan, muted, solo }) => {
        if (!stemsReady || !stems) return { ok: false, message: "אין ערוצים; vocals.stems מפריד" };
        const track = stems.tracks.find((item) => item.id === name);
        if (!track) return { ok: false, message: `אין ערוץ ${String(name)}; יש: ${stems.tracks.map((item) => item.id).join(", ")}` };
        const changes: Partial<MixTrack> = {};
        if (typeof gain === "number") changes.gain = Math.max(0, Math.min(1.5, gain / 100));
        if (typeof pan === "number") changes.pan = Math.max(-1, Math.min(1, pan / 100));
        if (typeof muted === "boolean") changes.muted = muted;
        if (typeof solo === "boolean") changes.solo = solo;
        if (!Object.keys(changes).length) return { ok: false, message: "לא צוין מה לשנות" };
        updateStem(track.id, changes);
        return { ok: true, message: `${track.name} עודכן` };
      },
      "vocals.download": () => {
        if (!result || busy) return { ok: false, message: audio ? "אין תוצאה מוכנה" : "אין שיר" };
        exportWav();
        return { ok: true, message: "קובץ ה־WAV ירד" };
      },
      "vocals.save": async () => {
        if (mode === "pro") {
          if (!stemsReady) return { ok: false, message: "אין ערוצים לשמור" };
          const saved = await saveStems();
          return saved ? { ok: true, message: "המיקס נשמר באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
        }
        if (!result || busy) return { ok: false, message: audio ? "אין תוצאה מוכנה" : "אין שיר" };
        const saved = await saveToProfile();
        return saved ? { ok: true, message: "התוצאה נשמרה באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
      "vocals.toMixer": () => {
        if (!stemsReady || !stems) return { ok: false, message: "אין ערוצים; vocals.stems מפריד" };
        void handOffTo("mixer", stems.tracks.map(stemFile), "הערוצים מהסרת השירה");
        return { ok: true, message: "הערוצים נשלחו למיקסר" };
      },
    },
  });

  return (
    <section className="tool-body vocals-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <MicVocal size={26} />
        </span>
        <div>
          <h1>הסרת שירה</h1>
          <p>בחר שיר והפרד בין השירה לליווי.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          onPick={(file) => {
            setError(null);
            setRendered(null);
            setUsedAi(false);
            setAiStatus(null);
            stopStems(true);
            void load(file);
          }}
          onClear={() => {
            setRendered(null);
            stopStems(true);
            clear();
          }}
          hint="קובץ סטריאו נותן את התוצאה הטובה ביותר"
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {initial && !audio && (
          <div className="notice-message" role="status">
            פתחת „{initial.title}”. ההגדרות שוחזרו; בחר את השיר שוב כדי להפיק את
            התוצאה מחדש.
          </div>
        )}
        {separation.error && !error && (
          <div className="error-message" role="alert">
            {separation.error}
          </div>
        )}
        {isMono && !usedAi && (
          <div className="notice-message" role="status">
            לקובץ מונו מומלץ לבחור בהפרדת AI.
          </div>
        )}

        {audio && (
          <>
            <div className="settings-panel">
              <div className="settings-grid">
                <div className="setting-field">
                  <span id="vocals-mode">מצב</span>
                  <div className="segmented-control" role="group" aria-labelledby="vocals-mode">
                    <button className={mode === "simple" ? "active" : ""} onClick={() => { stopStems(); setMode("simple"); }} type="button" aria-pressed={mode === "simple"} disabled={busy}>
                      פשוט
                    </button>
                    <button className={mode === "pro" ? "active" : ""} onClick={() => setMode("pro")} type="button" aria-pressed={mode === "pro"} disabled={busy}>
                      <Layers size={14} /> מקצועי
                    </button>
                  </div>
                  <small>{mode === "simple" ? "שירה או ליווי, בלחיצה." : "כל הערוצים בנפרד: שירה, תופים, בס ושאר הכלים — עם עוצמה, השתקה וסולו לכל אחד."}</small>
                </div>
                {mode === "simple" && (
                <>
                <div className="setting-field">
                  <span id="vocals-target">מה להשאיר?</span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-labelledby="vocals-target"
                  >
                    <button
                      className={target === "instrumental" ? "active" : ""}
                      onClick={() => setTarget("instrumental")}
                      type="button"
                      aria-pressed={target === "instrumental"}
                    >
                      ליווי בלבד (קריוקי)
                    </button>
                    <button
                      className={target === "vocals" ? "active" : ""}
                      onClick={() => setTarget("vocals")}
                      type="button"
                      aria-pressed={target === "vocals"}
                    >
                      שירה בלבד
                    </button>
                  </div>
                </div>
                <label className="setting-field range-field">
                  <span>
                    עוצמת ההפרדה <b>{strength}%</b>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={strength}
                    onChange={(event) => setStrength(Number(event.target.value))}
                  />
                  <small>הפחת את העוצמה להשארת חלק מהצליל המקורי.</small>
                </label>
                {target === "instrumental" && (
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={keepBass}
                      onChange={(event) => setKeepBass(event.target.checked)}
                    />
                    <span>שמור על הבס והתופים</span>
                  </label>
                )}
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={compare}
                    onChange={(event) => setCompare(event.target.checked)}
                  />
                  <span>השווה למקור בזמן ההשמעה</span>
                </label>
                </>
                )}
              </div>
            </div>

            {mode === "pro" && (
              <div className="vocals-pro">
                {!stems || stems.key !== audio.url ? (
                  <div className="ai-separator">
                    <div className="ai-separator-head">
                      <span className="tool-intro-icon">
                        <Layers size={20} />
                      </span>
                      <div>
                        <h3>
                          <Sparkles size={16} /> הפרדה לערוצים נפרדים
                        </h3>
                        <p>שירה, תופים, בס ושאר הכלים — כל אחד לערוץ משלו, בשרת. לוקח כדקה.{!user ? " צריך להתחבר לחשבון." : ""}</p>
                      </div>
                    </div>
                    <button className="primary-button compact" type="button" onClick={() => void runStems()} disabled={busy}>
                      <Sparkles size={17} /> הפרד לערוצים
                    </button>
                    {aiBusy && (
                      <>
                        <div className="progress-track" role="progressbar" aria-label="התקדמות ההפרדה" aria-valuenow={aiProgress} aria-valuemin={0} aria-valuemax={100}>
                          <div style={{ width: `${Math.max(2, aiProgress)}%` }} />
                        </div>
                        <button type="button" className="link-button" onClick={() => { aiAbortRef.current?.abort(); aiAbortRef.current = null; setAiBusy(false); setAiStatus("ההפרדה בוטלה."); }}>
                          בטל
                        </button>
                      </>
                    )}
                    {aiStatus && (
                      <small className="ai-status" role="status">
                        {aiStatus}
                      </small>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="mixer-tracks" role="list" aria-label="ערוצים">
                      {stems.tracks.map((track) => {
                        const audible = audibleTracks(stems.tracks).includes(track);
                        return (
                          <div key={track.id} role="listitem" className={`mixer-track ${audible ? "" : "is-silent"}`} style={{ "--track-hue": track.color } as React.CSSProperties}>
                            <div className="mixer-track-head">
                              <strong className="mixer-track-name">{track.name}</strong>
                              <button type="button" className={`mixer-toggle ${track.muted ? "active" : ""}`} onClick={() => updateStem(track.id, { muted: !track.muted })} aria-pressed={track.muted} aria-label={`השתק ${track.name}`} title="השתק (מחק מהמיקס)">
                                {track.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                              </button>
                              <button type="button" className={`mixer-toggle ${track.solo ? "active" : ""}`} onClick={() => updateStem(track.id, { solo: !track.solo })} aria-pressed={track.solo} aria-label={`סולו ${track.name}`} title="סולו">
                                <Headphones size={15} />
                              </button>
                              <button type="button" className="link-button" onClick={() => { const file = stemFile(track); downloadFile(file, file.name, "audio/wav"); }}>
                                <Download size={14} /> WAV
                              </button>
                            </div>
                            <div className="mixer-track-controls">
                              <label>
                                <span>עוצמה {Math.round(track.gain * 100)}%</span>
                                <input type="range" min={0} max={150} value={Math.round(track.gain * 100)} onChange={(event) => updateStem(track.id, { gain: Number(event.target.value) / 100 })} aria-label={`עוצמה של ${track.name}`} />
                              </label>
                              <label>
                                <span>פאן {track.pan === 0 ? "מרכז" : track.pan < 0 ? `שמאל ${Math.round(-track.pan * 100)}` : `ימין ${Math.round(track.pan * 100)}`}</span>
                                <input type="range" min={-100} max={100} value={Math.round(track.pan * 100)} onChange={(event) => updateStem(track.id, { pan: Number(event.target.value) / 100 })} aria-label={`פאן של ${track.name}`} />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="transport">
                      <button
                        className="transport-button primary"
                        type="button"
                        onClick={() => {
                          const player = stemsPlayerRef.current;
                          if (!player) return;
                          if (player.isPlaying) {
                            player.pause();
                            setStemsPlaying(false);
                          } else void player.play().then((started) => setStemsPlaying(started));
                        }}
                      >
                        {stemsPlaying ? "השהה" : "נגן את המיקס"}
                      </button>
                      <button className="transport-button" type="button" onClick={() => stopStems()} aria-label="עצור">
                        ■
                      </button>
                      <small className="ai-status">{aiStatus}</small>
                    </div>
                    <div className="downloads-card">
                      <div>
                        <span className="download-icon">
                          <Download size={22} />
                        </span>
                        <div>
                          <h3>המיקס שלך</h3>
                          <p>הערוצים שהשארת, בעוצמות שבחרת — כקובץ WAV אחד, או כל ערוץ בנפרד למעלה.</p>
                        </div>
                      </div>
                      <div className="download-buttons">
                        <button type="button" disabled={stemsRendering} onClick={() => void renderStemMix().then((file) => file && downloadFile(file, file.name, "audio/wav"))}>
                          <Download size={17} />
                          <span>
                            {stemsRendering ? "מרנדר…" : "הורד מיקס"}
                            <small>WAV</small>
                          </span>
                        </button>
                        <button type="button" onClick={() => void handOffTo("mixer", stems.tracks.map(stemFile), "הערוצים מהסרת השירה")}>
                          <Layers size={17} />
                          <span>
                            למיקסר<small>עם לולאה והזזות</small>
                          </span>
                        </button>
                      </div>
                      <SaveButton state={saving.state} onSave={() => void saveStems()} disabled={stemsRendering} label="שמור את המיקס" message={saving.message} />
                    </div>
                  </>
                )}
              </div>
            )}

            {mode === "simple" && (
            <>

            {separation.isRunning ? (
              <div className="processing-box">
                <div className="processing-top">
                  <span>
                    <Wand2 size={18} /> מפריד את הצלילים…
                  </span>
                  <strong aria-live="polite">{separation.progress}%</strong>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="התקדמות ההפרדה"
                  aria-valuenow={separation.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div style={{ width: `${separation.progress}%` }} />
                </div>
              </div>
            ) : (
              <Transport
                buffer={compare ? audio.buffer : result}
                label={
                  compare
                    ? "השמע את המקור"
                    : target === "instrumental"
                      ? "השמע את הקריוקי"
                      : "השמע את השירה"
                }
              />
            )}

            {usedAi && (
              <p className="engine-note">
                תוצאת AI. שינוי ההגדרות יחזיר להפרדה מהירה.
              </p>
            )}
            {!usedAi && result && !wasMono && (
              <p className="engine-note is-slow">
                זו תצוגה מהירה המבוססת על מיקום השירה בסטריאו. לתוצאה שמפרידה באמת בין הקול
                למוזיקה, לחץ על הפרדה מלאה עם AI.
              </p>
            )}
            {wasMono && !usedAi && (
              <p className="engine-note is-slow">
                תוצאת ההפרדה חלקית.
              </p>
            )}

            <div className="ai-separator">
              <div className="ai-separator-head">
                <span className="tool-intro-icon">
                  <Cpu size={20} />
                </span>
                <div>
                  <h3>
                    <Sparkles size={16} /> הפרדה מלאה עם AI
                  </h3>
                  <p>
                    {serverMissing === true
                      ? "מודל Demucs אמיתי מפריד את הקול, התופים, הבס ושאר המוזיקה בדפדפן. בפעם הראשונה יורדים כ־180MB; כדאי להשאיר את הכרטיסייה פתוחה. אין צורך להתחבר."
                      : serverMissing === false
                        ? `נעשית בשרת של האתר ועובדת גם בטלפון. לוקח בדרך כלל כדקה.${!user ? " צריך להתחבר לחשבון." : ""}`
                        : "בודק את מנוע ההפרדה הזמין…"}
                  </p>
                </div>
              </div>
              <>
                <button
                  className="primary-button compact"
                  type="button"
                  onClick={runAi}
                  disabled={busy}
                >
                  <Sparkles size={17} />
                  {target === "instrumental"
                    ? "הפק אינסטרומנטלי עם AI"
                    : "הפק שירה בלבד עם AI"}
                </button>
                {serverMissing === true && !aiBusy && aiStatus?.includes("נכשלה") && (
                  <button className="link-button" type="button" onClick={runAiInBrowser} disabled={busy}>
                    <Cpu size={14} /> נסה שוב את מודל ה־AI בדפדפן
                  </button>
                )}
                {aiBusy && (
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => {
                      aiAbortRef.current?.abort();
                      aiAbortRef.current = null;
                      setAiBusy(false);
                      setAiStatus("ההפרדה בוטלה.");
                    }}
                  >
                    בטל
                  </button>
                )}
                {aiBusy && (
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label="התקדמות הפרדת ה־AI"
                    aria-valuenow={aiProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div style={{ width: `${Math.max(2, aiProgress)}%` }} />
                  </div>
                )}
              </>
              {aiStatus && (
                <small className="ai-status" role="status">
                  {aiStatus}
                </small>
              )}
            </div>

            <div className="downloads-card">
              <div>
                <span className="download-icon">
                  <Download size={22} />
                </span>
                <div>
                  <h3>הורדת התוצאה</h3>
                  <p>קובץ WAV.</p>
                </div>
              </div>
              <div className="download-buttons">
                <button onClick={exportWav} type="button" disabled={!result || busy}>
                  <MicVocal size={17} />
                  <span>
                    WAV
                    <small>
                      {target === "instrumental" ? "גרסת קריוקי" : "השירה בלבד"}
                    </small>
                  </span>
                </button>
                <ShareButton
                  build={buildFile}
                  title={target === "instrumental" ? "גרסת קריוקי" : "השירה בלבד"}
                />
              </div>
              <SaveButton
                state={saving.state}
                onSave={() => void saveToProfile()}
                disabled={!result || busy}
                message={saving.message}
              />
            </div>
            </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
