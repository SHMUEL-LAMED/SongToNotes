import { Download, FileAudio, Headphones, Layers, Mic, Play, Square, Timer, Trash2, Voicemail, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { validateAudioFile } from "../components/AudioPicker";
import { decodeAudioFile } from "../lib/audio";
import { downloadFile } from "../lib/export";
import { handOffTo } from "../lib/handoff";
import { audibleTracks, mixDuration, renderMix, type MixTrack } from "../lib/mixer";
import { useOfferResult } from "../lib/currentFile";
import {
  MAX_LATENCY_OFFSET_MS,
  MAX_TAKE_SECONDS,
  MAX_TRACKS,
  MIN_LATENCY_OFFSET_MS,
  assembleTake,
  clampBpm,
  clampCountIn,
  clampLatencyOffset,
  clicksInWindow,
  countInSeconds,
  describeMicError,
  estimateRoundTripSeconds,
  formatClock,
  miniPeaks,
  nextTrackName,
  peaksPath,
  playheadFraction,
  readLatencyOffset,
  secondsPerBeat,
  totalLatencySeconds,
  writeLatencyOffset,
  type CaptureChunk,
  type ClickPlan,
} from "../lib/recorder";
import { useAssistantTool } from "../lib/useAssistantTool";
import { encodeWav, fromAudioBuffer } from "../lib/wav";
import "./recorder.css";

const HUES = [12, 200, 300, 120, 45, 260, 340, 170];
const WAVE_WIDTH = 400;
const WAVE_HEIGHT = 40;
/** How far ahead of the clock clicks are booked, and how often the booking runs. */
const CLICK_LOOKAHEAD = 0.15;
const CLICK_TICK_MS = 25;
/** Room for the graph to start the sources before the first scheduled sample. */
const START_LEAD = 0.2;

type RecTrack = MixTrack & { source: "mic" | "file"; path: string };
type Phase = "idle" | "arming" | "countin" | "recording" | "finishing" | "playing";
type Settings = { bpm: number; beatsPerBar: 3 | 4; countIn: number; click: boolean; clickVolume: number };
type Live = { id: string; source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode | null };

/**
 * The capture processor, loaded from a Blob URL so the tool needs no extra
 * file in the build. It batches the 128-frame render quanta into larger
 * chunks (fewer messages to the main thread) and stamps each with the
 * context frame of its first sample — that stamp is what lets the take be
 * lined up against the backing tracks to the sample.
 */
const WORKLET_SOURCE = `
class RecorderCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
    this.startFrame = 0;
    this.active = true;
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        this.flush();
        this.active = false;
        this.port.postMessage({ done: true });
      }
    };
  }
  flush() {
    if (!this.filled) return;
    const data = this.buffer.slice(0, this.filled);
    this.port.postMessage({ frame: this.startFrame, data }, [data.buffer]);
    this.filled = 0;
  }
  process(inputs) {
    if (!this.active) return false;
    const channel = inputs[0] && inputs[0][0];
    const frames = channel ? channel.length : 128;
    if (this.filled + frames > this.size) this.flush();
    if (this.filled === 0) this.startFrame = currentFrame;
    if (channel) this.buffer.set(channel, this.filled);
    else this.buffer.fill(0, this.filled, this.filled + frames);
    this.filled += frames;
    return true;
  }
}
registerProcessor("recorder-capture", RecorderCapture);
`;

type Capture = {
  chunks: CaptureChunk[];
  analyser: AnalyserNode;
  inputLatency: number | undefined;
  /** Flushes what the processor still holds, then lets go of the microphone. */
  stop: () => Promise<void>;
  /** The same, synchronously, for unmount: whatever is unflushed is lost. */
  release: () => void;
};

function audioContextClass() {
  return window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function isMicSupported() {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && Boolean(audioContextClass());
}

const loadedWorklets = new WeakSet<BaseAudioContext>();

async function openCapture(context: AudioContext, stream: MediaStream): Promise<Capture> {
  const chunks: CaptureChunk[] = [];
  const input = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  input.connect(analyser);
  // Neither processor runs unless something downstream pulls on it; a muted
  // gain into the speakers does that without letting the mic be heard.
  const sink = context.createGain();
  sink.gain.value = 0;
  sink.connect(context.destination);
  const settings = stream.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
  const releaseStream = () => stream.getTracks().forEach((track) => track.stop());

  let node: AudioWorkletNode | null = null;
  if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
    try {
      if (!loadedWorklets.has(context)) {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
        try {
          await context.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        loadedWorklets.add(context);
      }
      node = new AudioWorkletNode(context, "recorder-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
    } catch {
      // A blocked Blob URL or an old engine: the script processor below still works.
      node = null;
    }
  }

  if (node) {
    const worklet = node;
    let finished: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    worklet.port.onmessage = (event: MessageEvent<{ frame?: number; data?: Float32Array; done?: boolean }>) => {
      const message = event.data;
      if (message.done) finished();
      else if (message.data && typeof message.frame === "number") chunks.push({ frame: message.frame, data: message.data });
    };
    input.connect(worklet);
    worklet.connect(sink);
    const release = () => {
      worklet.port.onmessage = null;
      input.disconnect();
      worklet.disconnect();
      sink.disconnect();
      releaseStream();
    };
    return {
      chunks,
      analyser,
      inputLatency: settings?.latency,
      stop: async () => {
        worklet.port.postMessage("flush");
        await Promise.race([done, new Promise((resolve) => window.setTimeout(resolve, 400))]);
        release();
      },
      release,
    };
  }

  // The fallback has no frame stamp of its own. The first callback is
  // anchored to the clock, one buffer before the time its output would play,
  // and every later buffer is counted on from there so the take stays
  // contiguous; the latency slider absorbs the anchor's uncertainty.
  const size = 4096;
  const processor = context.createScriptProcessor(size, 1, 1);
  let nextFrame: number | null = null;
  processor.onaudioprocess = (event) => {
    if (nextFrame === null) nextFrame = Math.max(0, Math.round(event.playbackTime * context.sampleRate) - size);
    chunks.push({ frame: nextFrame, data: event.inputBuffer.getChannelData(0).slice() });
    nextFrame += event.inputBuffer.length;
  };
  input.connect(processor);
  processor.connect(sink);
  const release = () => {
    processor.onaudioprocess = null;
    input.disconnect();
    processor.disconnect();
    sink.disconnect();
    releaseStream();
  };
  return {
    chunks,
    analyser,
    inputLatency: settings?.latency,
    stop: async () => release(),
    release,
  };
}

function makeTrack(buffer: AudioBuffer, name: string, index: number, source: RecTrack["source"]): RecTrack {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    buffer,
    gain: 1,
    pan: 0,
    muted: false,
    solo: false,
    offset: 0,
    color: HUES[index % HUES.length],
    source,
    path: peaksPath(miniPeaks(channels, 160), WAVE_WIDTH, WAVE_HEIGHT),
  };
}

function defaultSettings(): Settings {
  return { bpm: 100, beatsPerBar: 4, countIn: 1, click: true, clickVolume: 0.6 };
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A multitrack recorder for layering a song alone: each take is recorded
 * from the microphone while the takes before it play back (and a click keeps
 * time), then slid earlier by the sound card's round trip so it lands where
 * it was played rather than where it was heard. Capture is raw PCM stamped
 * with the audio clock, not a compressed recording decoded afterwards, so the
 * alignment is exact and there is no codec delay to guess at.
 */
export function RecorderTool() {
  const [tracks, setTracks] = useState<RecTrack[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [position, setPosition] = useState(0);
  const [level, setLevel] = useState(0);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [latencyOffset, setLatencyOffset] = useState(() => readLatencyOffset(storage()));
  const [measuredLatency, setMeasuredLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"import" | "export" | "handoff" | null>(null);
  const [supported] = useState(isMicSupported);

  const contextRef = useRef<AudioContext | null>(null);
  const tracksRef = useRef(tracks);
  const settingsRef = useRef(settings);
  const latencyOffsetRef = useRef(latencyOffset);
  const phaseRef = useRef<Phase>("idle");
  const liveRef = useRef<Live[]>([]);
  const sessionRef = useRef<{ kind: "play" | "record"; at: number; capture?: Capture; latency?: number; clicks?: number } | null>(null);
  const clickNodesRef = useRef<OscillatorNode[]>([]);
  const frameRef = useRef(0);
  const mountedRef = useRef(false);
  const stopRecordingRef = useRef<() => Promise<string | null>>(async () => null);
  const stopPlaybackRef = useRef<() => void>(() => undefined);
  const playRef = useRef<() => Promise<string | null>>(async () => null);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  const changePhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  // Settings live in a ref as well as in state so an assistant turn that
  // sets the tempo and then records in the same breath records at the new tempo.
  const updateSettings = (patch: Partial<Settings>) => {
    settingsRef.current = { ...settingsRef.current, ...patch };
    setSettings(settingsRef.current);
  };

  const updateLatencyOffset = (value: number) => {
    const clamped = clampLatencyOffset(value);
    latencyOffsetRef.current = clamped;
    setLatencyOffset(clamped);
    writeLatencyOffset(storage(), clamped);
  };

  const ensureContext = async () => {
    let context = contextRef.current;
    if (!context || context.state === "closed") {
      const Context = audioContextClass();
      if (!Context) return null;
      context = new Context({ latencyHint: "interactive" });
      contextRef.current = context;
    }
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    return context;
  };

  const stopSources = () => {
    for (const node of liveRef.current) {
      try {
        node.source.stop();
      } catch {
        // Never started or already ended.
      }
      node.source.disconnect();
      node.gain.disconnect();
      node.pan?.disconnect();
    }
    liveRef.current = [];
  };

  const stopClicks = () => {
    const session = sessionRef.current;
    if (session?.clicks) window.clearInterval(session.clicks);
    if (session) session.clicks = undefined;
    for (const oscillator of clickNodesRef.current) {
      try {
        oscillator.stop();
      } catch {
        // Already stopped.
      }
      oscillator.disconnect();
    }
    clickNodesRef.current = [];
  };

  /**
   * Every track gets a source even when muted: silencing through its gain
   * lets mute and solo change live without restarting the others mid-note.
   */
  const scheduleTracks = (context: AudioContext, at: number) => {
    stopSources();
    const audible = new Set(audibleTracks(tracksRef.current).map((track) => track.id));
    for (const track of tracksRef.current) {
      const source = context.createBufferSource();
      source.buffer = track.buffer;
      const gain = context.createGain();
      gain.gain.value = audible.has(track.id) ? track.gain : 0;
      const pan = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
      if (pan) pan.pan.value = track.pan;
      source.connect(gain);
      if (pan) gain.connect(pan).connect(context.destination);
      else gain.connect(context.destination);
      source.start(at + track.offset);
      liveRef.current.push({ id: track.id, source, gain, pan });
    }
  };

  // Levels follow the sliders while playing; a deleted track falls silent at once.
  useEffect(() => {
    const audible = new Set(audibleTracks(tracks).map((track) => track.id));
    for (const node of liveRef.current) {
      const track = tracks.find((item) => item.id === node.id);
      node.gain.gain.value = track && audible.has(track.id) ? track.gain : 0;
      if (track && node.pan) node.pan.pan.value = track.pan;
    }
  }, [tracks]);

  const startClicks = (context: AudioContext, plan: ClickPlan) => {
    const session = sessionRef.current;
    if (!session) return;
    let bookedUntil = context.currentTime;
    const volume = settingsRef.current.clickVolume;
    const book = () => {
      const until = context.currentTime + CLICK_LOOKAHEAD;
      for (const click of clicksInWindow(plan, bookedUntil, until)) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = click.accent ? 1760 : 1175;
        const peak = (click.countIn ? 0.55 : 0.4) * volume;
        gain.gain.setValueAtTime(0.0001, click.time);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), click.time + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, click.time + 0.05);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(click.time);
        oscillator.stop(click.time + 0.06);
        oscillator.onended = () => {
          gain.disconnect();
          clickNodesRef.current = clickNodesRef.current.filter((item) => item !== oscillator);
        };
        clickNodesRef.current.push(oscillator);
      }
      bookedUntil = Math.max(bookedUntil, until);
    };
    book();
    session.clicks = window.setInterval(book, CLICK_TICK_MS);
  };

  const runFrames = () => {
    cancelAnimationFrame(frameRef.current);
    const tick = () => {
      const context = contextRef.current;
      const session = sessionRef.current;
      if (!context || !session) return;
      const now = context.currentTime - session.at;
      setPosition(now);
      if (session.kind === "record") {
        if (phaseRef.current === "countin" && now >= 0) changePhase("recording");
        const analyser = session.capture?.analyser;
        if (analyser) {
          const samples = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(samples);
          let peak = 0;
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
          setLevel(Math.min(1, peak * 1.4));
        }
        if (now >= MAX_TAKE_SECONDS) {
          void stopRecordingRef.current();
          return;
        }
      } else if (now >= mixDuration(tracksRef.current) + 0.05) {
        stopPlaybackRef.current();
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  const stopPlayback = () => {
    if (sessionRef.current?.kind !== "play") return;
    cancelAnimationFrame(frameRef.current);
    stopSources();
    sessionRef.current = null;
    setPosition(0);
    changePhase("idle");
  };

  const play = async (): Promise<string | null> => {
    if (phaseRef.current === "playing") return null;
    if (phaseRef.current !== "idle") return "אי אפשר לנגן בזמן הקלטה.";
    if (!tracksRef.current.length) return "אין עדיין ערוצים לנגן.";
    const context = await ensureContext();
    if (!context) return "הדפדפן הזה אינו תומך בנגינת אודיו.";
    const at = context.currentTime + 0.06;
    scheduleTracks(context, at);
    sessionRef.current = { kind: "play", at };
    changePhase("playing");
    runFrames();
    return null;
  };

  /** Resolves with an error to show, or null once the count-in has begun. */
  const startRecording = async (): Promise<string | null> => {
    if (phaseRef.current === "playing") stopPlayback();
    if (phaseRef.current !== "idle") return "כבר מקליט.";
    if (tracksRef.current.length >= MAX_TRACKS) return `אפשר עד ${MAX_TRACKS} ערוצים. מחק ערוץ כדי להקליט עוד אחד.`;
    if (!supported) return "הדפדפן הזה אינו תומך בהקלטה מהמיקרופון. נסה בכרום, אדג׳, פיירפוקס או ספארי עדכני.";
    setError(null);
    setNotice(null);
    changePhase("arming");
    const context = await ensureContext();
    if (!context) {
      changePhase("idle");
      return "הדפדפן הזה אינו תומך בעיבוד אודיו.";
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (caught) {
      changePhase("idle");
      return describeMicError(caught);
    }
    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return null;
    }
    let capture: Capture;
    try {
      capture = await openCapture(context, stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      changePhase("idle");
      return "לא הצלחנו להתחיל את ההקלטה בדפדפן הזה.";
    }
    // Loading the capture worklet takes a moment; a visitor who left the
    // page meanwhile must not leave the microphone open (and a click
    // scheduler running) behind a tool that no longer exists.
    if (!mountedRef.current) {
      capture.release();
      return null;
    }
    const auto = estimateRoundTripSeconds({
      baseLatency: context.baseLatency,
      outputLatency: context.outputLatency,
      inputLatency: capture.inputLatency,
    });
    setMeasuredLatency(auto);
    const current = settingsRef.current;
    const lead = countInSeconds(current.bpm, current.countIn, current.beatsPerBar);
    const at = context.currentTime + START_LEAD + lead;
    sessionRef.current = { kind: "record", at, capture, latency: totalLatencySeconds(auto, latencyOffsetRef.current) };
    scheduleTracks(context, at);
    startClicks(context, { bpm: current.bpm, beatsPerBar: current.beatsPerBar, countInBars: current.countIn, takeStart: at, clickDuringTake: current.click });
    setPosition(-lead - START_LEAD);
    changePhase(lead > 0 ? "countin" : "recording");
    runFrames();
    return null;
  };

  /** Resolves with why no track was kept, or null when one was added. */
  const stopRecording = async (): Promise<string | null> => {
    const session = sessionRef.current;
    const context = contextRef.current;
    if (!session || session.kind !== "record" || !session.capture || !context) return "אין הקלטה פעילה.";
    cancelAnimationFrame(frameRef.current);
    stopClicks();
    stopSources();
    sessionRef.current = null;
    const endedAt = context.currentTime;
    changePhase("finishing");
    await session.capture.stop();
    setLevel(0);
    setPosition(0);
    if (!mountedRef.current) return null;
    const rate = context.sampleRate;
    if (endedAt < session.at + 0.15) {
      const notice = "ההקלטה נעצרה לפני שהתחילה, ולא נשמר ערוץ.";
      setNotice(notice);
      changePhase("idle");
      return notice;
    }
    const samples = assembleTake(session.capture.chunks, {
      startFrame: Math.round(session.at * rate),
      latencyFrames: Math.round((session.latency ?? 0) * rate),
      maxFrames: MAX_TAKE_SECONDS * rate,
    });
    if (samples.length < rate * 0.1) {
      const notice = "ההקלטה קצרה מדי, ולא נשמר ערוץ.";
      setNotice(notice);
      changePhase("idle");
      return notice;
    }
    const buffer = context.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);
    setTracks((list) => (list.length >= MAX_TRACKS ? list : [...list, makeTrack(buffer, nextTrackName(list.map((track) => track.name)), list.length, "mic")]));
    changePhase("idle");
    return null;
  };

  // The animation frame loop and the space key run outside React's render
  // cycle, so they reach the latest transport functions through refs.
  useEffect(() => {
    stopPlaybackRef.current = stopPlayback;
    stopRecordingRef.current = stopRecording;
    playRef.current = play;
  });

  // Everything the tool opened is closed on the way out: the sources, the
  // clicks, the microphone and the context itself.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(frameRef.current);
      const session = sessionRef.current;
      if (session?.clicks) window.clearInterval(session.clicks);
      session?.capture?.release();
      sessionRef.current = null;
      for (const node of liveRef.current) {
        try {
          node.source.stop();
        } catch {
          // Already stopped.
        }
      }
      liveRef.current = [];
      for (const oscillator of clickNodesRef.current) {
        try {
          oscillator.stop();
        } catch {
          // Already stopped.
        }
      }
      clickNodesRef.current = [];
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    };
  }, []);

  const toggleRecord = async () => {
    if (phaseRef.current === "countin" || phaseRef.current === "recording") {
      await stopRecording();
      return;
    }
    const problem = await startRecording();
    if (problem) setError(problem);
  };

  const togglePlay = async () => {
    if (phaseRef.current === "playing") {
      stopPlayback();
      return;
    }
    const problem = await play();
    if (problem) setError(problem);
  };

  // Space runs the transport, as in every recording program — unless the
  // visitor is typing a track name or pressing a focused button, where the
  // key already means something.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable=''], [contenteditable='true'], [role='slider']")) return;
      event.preventDefault();
      const current = phaseRef.current;
      if (current === "countin" || current === "recording") void stopRecordingRef.current();
      else if (current === "playing") stopPlaybackRef.current();
      else if (current === "idle") void playRef.current().then((problem) => problem && setError(problem));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const updateTrack = (id: string, patch: Partial<RecTrack>) => {
    setTracks((list) => list.map((track) => (track.id === id ? { ...track, ...patch } : track)));
  };

  const removeTrack = (id: string) => {
    setTracks((list) => list.filter((track) => track.id !== id));
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_TRACKS - tracksRef.current.length;
    if (room <= 0) {
      setError(`אפשר עד ${MAX_TRACKS} ערוצים.`);
      return;
    }
    setBusy("import");
    setError(null);
    setNotice(null);
    for (const file of Array.from(files).slice(0, room)) {
      const problem = validateAudioFile(file);
      if (problem) {
        setError(problem);
        continue;
      }
      try {
        const buffer = await decodeAudioFile(await file.arrayBuffer());
        const name = file.name.replace(/\.[^/.]+$/, "").slice(0, 60) || "קובץ";
        setTracks((list) => (list.length >= MAX_TRACKS ? list : [...list, makeTrack(buffer, name, list.length, "file")]));
      } catch (caught) {
        setError(caught instanceof Error && caught.message ? caught.message : `לא הצלחנו לפתוח את „${file.name}”.`);
      }
    }
    if (files.length > room) setNotice(`נוספו ${room} קבצים בלבד — אפשר עד ${MAX_TRACKS} ערוצים.`);
    setBusy(null);
  };

  // The mix of every take can go on to another tool — the vocal remover, a
  // ringtone, the converter — built only if someone sends it.
  useOfferResult(audibleTracks(tracks).length ? tracks : null, "multitrack-mix.wav", async () => {
    const rendered = await renderMix(tracksRef.current, 44_100);
    const blob = encodeWav({ channels: [rendered.getChannelData(0), rendered.getChannelData(1)], sampleRate: rendered.sampleRate });
    return new File([blob], "multitrack-mix.wav", { type: "audio/wav" });
  });

  const exportMix = async (): Promise<File | null> => {
    if (!tracksRef.current.length) return null;
    if (!audibleTracks(tracksRef.current).length) {
      setError("כל הערוצים מושתקים — אין מה לייצא.");
      return null;
    }
    setBusy("export");
    setError(null);
    try {
      const rendered = await renderMix(tracksRef.current, 44_100);
      const blob = encodeWav({ channels: [rendered.getChannelData(0), rendered.getChannelData(1)], sampleRate: rendered.sampleRate });
      // An ASCII name: some Chromium builds fall back to a bare "download"
      // for a Hebrew one, which then opens nowhere.
      const file = new File([blob], "multitrack-mix.wav", { type: "audio/wav" });
      downloadFile(file, file.name, file.type);
      return file;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "הייצוא נכשל.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const sendToMixer = async () => {
    if (!tracks.length) return;
    stopPlayback();
    setBusy("handoff");
    setError(null);
    try {
      const files = tracks.map((track, index) => {
        const blob = encodeWav(fromAudioBuffer(track.buffer));
        // The mixer names its tracks after the files, so the name keeps its
        // spaces; only what a file system refuses is replaced.
        const base = track.name.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80);
        return new File([blob], `${base || `track-${index + 1}`}.wav`, { type: "audio/wav" });
      });
      await handOffTo("mixer", files, "הערוצים מהמקליט");
    } catch {
      setError("לא הצלחנו להעביר את הערוצים למיקסר.");
      setBusy(null);
    }
  };

  const duration = mixDuration(tracks);
  const recordingNow = phase === "countin" || phase === "recording";
  const beat = secondsPerBeat(settings.bpm);
  const countInBeats = settings.countIn * settings.beatsPerBar;
  const beatsLeft = phase === "countin" ? Math.min(countInBeats, Math.max(1, Math.ceil(-position / beat - 1e-6))) : 0;
  const autoLatency = measuredLatency ?? estimateRoundTripSeconds({});
  const totalLatencyMs = Math.round(totalLatencySeconds(autoLatency, latencyOffset) * 1000);
  const timelineLength = recordingNow ? Math.max(duration, position) : duration;
  const playhead = phase === "playing" || phase === "recording" ? playheadFraction(position, timelineLength) : null;
  const anySolo = tracks.some((track) => track.solo);
  const full = tracks.length >= MAX_TRACKS;

  const describeTracks = () =>
    tracks
      .map((track, index) => `${index + 1}. „${track.name}” (${formatClock(track.buffer.duration)}, עוצמה ${Math.round(track.gain * 100)}%${track.pan ? `, פאן ${Math.round(track.pan * 100)}` : ""}${track.muted ? ", מושתק" : ""}${track.solo ? ", סולו" : ""})`)
      .join("; ");

  useAssistantTool("recorder", {
    state: () =>
      `מקליט רב־ערוצי: ${tracks.length ? `${tracks.length} ערוצים — ${describeTracks()}` : "אין עדיין ערוצים"}; קצב ${settings.bpm}, ${settings.beatsPerBar}/4, ספירה ${settings.countIn} תיבות, מטרונום ${settings.click ? "פועל" : "כבוי"}${
        recordingNow ? "; מקליט עכשיו" : phase === "playing" ? "; מנגן" : ""
      }${supported ? "" : "; הדפדפן אינו תומך בהקלטה"}.`,
    handlers: {
      "recorder.record": async ({ command }) => {
        if (command === "stop") {
          if (phaseRef.current !== "countin" && phaseRef.current !== "recording") return { ok: false, message: "אין הקלטה פעילה" };
          // A take stopped during the count-in, or too short, adds nothing.
          const notice = await stopRecording();
          return notice ? { ok: false, message: notice } : { ok: true, message: "ההקלטה נעצרה והערוץ נוסף" };
        }
        if (phaseRef.current !== "idle" && phaseRef.current !== "playing") return { ok: false, message: "כבר מקליט" };
        const problem = await startRecording();
        if (problem) {
          setError(problem);
          return { ok: false, message: problem };
        }
        const bars = settingsRef.current.countIn;
        return { ok: true, message: bars ? `ספירה של ${bars === 1 ? "תיבה אחת" : "שתי תיבות"} ואז מקליט` : "מקליט" };
      },
      "recorder.play": async ({ command }) => {
        if (command === "stop") {
          if (phaseRef.current !== "playing") return { ok: true, message: "לא ניגן" };
          stopPlayback();
          return { ok: true, message: "נעצר" };
        }
        const problem = await play();
        return problem ? { ok: false, message: problem } : { ok: true, message: "מנגן את כל הערוצים מההתחלה" };
      },
      "recorder.set": ({ bpm, click, countIn }) => {
        const patch: Partial<Settings> = {};
        if (typeof bpm === "number") patch.bpm = clampBpm(bpm, settingsRef.current.bpm);
        if (typeof click === "boolean") patch.click = click;
        if (typeof countIn === "number") patch.countIn = clampCountIn(countIn, settingsRef.current.countIn);
        if (!Object.keys(patch).length) return { ok: false, message: "לא צוין מה לשנות" };
        updateSettings(patch);
        const next = settingsRef.current;
        return { ok: true, message: `קצב ${next.bpm}, מטרונום ${next.click ? "פועל" : "כבוי"}, ספירה ${next.countIn} תיבות` };
      },
      "recorder.tracks": () => ({
        ok: true,
        message: tracks.length ? `${tracks.length} ערוצים` : "אין עדיין ערוצים",
        data: {
          tracks: tracks.map((track, index) => ({
            index: index + 1,
            name: track.name,
            seconds: Number(track.buffer.duration.toFixed(2)),
            gain: Math.round(track.gain * 100),
            pan: Math.round(track.pan * 100),
            muted: track.muted,
            solo: track.solo,
            source: track.source === "mic" ? "הקלטה" : "קובץ",
          })),
          duration: Number(duration.toFixed(2)),
        },
      }),
      "recorder.export": async () => {
        if (!tracks.length) return { ok: false, message: "אין ערוצים לייצא" };
        if (busy) return { ok: false, message: "רגע, עוד עובד" };
        const file = await exportMix();
        return file ? { ok: true, message: `המיקס ירד: ${file.name}` } : { ok: false, message: "הייצוא נכשל" };
      },
    },
  });

  const statusText = (() => {
    if (phase === "arming") return "פותח את המיקרופון…";
    if (phase === "countin") return "ספירה לאחור";
    if (phase === "recording") return "מקליט";
    if (phase === "finishing") return "שומר את הערוץ…";
    if (phase === "playing") return "מנגן";
    return full ? `הגעת ל־${MAX_TRACKS} ערוצים` : tracks.length ? "מוכן לערוץ הבא" : "מוכן להקלטה";
  })();

  return (
    <section className="tool-body recorder-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Voicemail size={26} />
        </span>
        <div>
          <h1>מקליט רב־ערוצי</h1>
          <p>מקליטים ערוץ אחרי ערוץ ושומעים בזמן ההקלטה את כל מה שכבר הוקלט — עם מטרונום, ספירה לאחור ותיקון השהיה. הכול נשאר במחשב שלך.</p>
        </div>
      </div>

      {!supported && (
        <div className="error-message" role="alert">
          הדפדפן הזה אינו תומך בהקלטה מהמיקרופון (או שהאתר לא נפתח בחיבור מאובטח). אפשר עדיין לייבא קבצים, לערבב ולייצא.
        </div>
      )}

      <div className="workspace-card recorder-deck">
        <div className={`recorder-stage is-${phase}`}>
          <button
            type="button"
            className={`recorder-record ${recordingNow ? "is-live" : ""}`}
            onClick={() => void toggleRecord()}
            disabled={!supported || phase === "arming" || phase === "finishing" || (!recordingNow && full)}
            aria-label={recordingNow ? "עצור הקלטה" : "הקלט ערוץ חדש"}
          >
            {recordingNow ? <Square size={26} /> : <Mic size={28} />}
          </button>
          <div className="recorder-status" aria-live="polite">
            <span className="recorder-status-label">
              {recordingNow && <i className="recorder-dot" aria-hidden="true" />}
              {statusText}
            </span>
            {phase === "countin" ? (
              <strong className="recorder-countin" dir="ltr">
                {beatsLeft}
              </strong>
            ) : (
              <strong className="recorder-clock" dir="ltr">
                {formatClock(Math.max(0, position))}
                {phase !== "recording" && duration > 0 && <small> / {formatClock(duration)}</small>}
              </strong>
            )}
            <small className="recorder-hint">
              {recordingNow ? "לחיצה על הכפתור או על מקש הרווח עוצרת ושומרת את הערוץ." : "מומלץ להקליט עם אוזניות, כדי שהמיקרופון לא יקלוט את הערוצים הקודמים."}
            </small>
          </div>
          {recordingNow && (
            <div className="recorder-meter" role="meter" aria-label="עוצמת המיקרופון" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
              <span style={{ inlineSize: `${Math.round(level * 100)}%` }} />
            </div>
          )}
        </div>

        <div className="recorder-transport">
          <button type="button" className="transport-button primary" onClick={() => void togglePlay()} disabled={!tracks.length || (phase !== "idle" && phase !== "playing")}>
            {phase === "playing" ? <Square size={16} /> : <Play size={18} />}
            {phase === "playing" ? "עצור" : "נגן הכול"}
          </button>
          <label className="secondary-button recorder-import">
            <input type="file" className="native-file-input" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.webm,.aac" multiple disabled={full || busy === "import" || recordingNow} onChange={(event) => { void importFiles(event.target.files); event.target.value = ""; }} aria-label="ייבוא קובץ שמע כערוץ" />
            <FileAudio size={17} />
            {busy === "import" ? "פותח…" : "ייבוא קובץ"}
          </label>
          <span className="recorder-count" dir="ltr">
            {tracks.length}/{MAX_TRACKS}
          </span>
        </div>

        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="notice-message" role="status">
            {notice}
          </div>
        )}

        {tracks.length > 0 ? (
          <div className="recorder-tracks" role="list" aria-label="ערוצים">
            {tracks.map((track) => {
              const silent = track.muted || (anySolo && !track.solo);
              const width = timelineLength > 0 ? Math.min(100, (track.buffer.duration / timelineLength) * 100) : 100;
              return (
                <div key={track.id} role="listitem" className={`recorder-track ${silent ? "is-silent" : ""}`} style={{ "--track-hue": track.color } as CSSProperties}>
                  <div className="recorder-track-head">
                    <span className="recorder-track-kind" title={track.source === "mic" ? "הוקלט מהמיקרופון" : "קובץ מיובא"}>
                      {track.source === "mic" ? <Mic size={14} /> : <FileAudio size={14} />}
                    </span>
                    <input className="recorder-track-name" value={track.name} onChange={(event) => updateTrack(track.id, { name: event.target.value.slice(0, 60) })} aria-label="שם הערוץ" dir="auto" />
                    <span className="recorder-track-time" dir="ltr">
                      {formatClock(track.buffer.duration)}
                    </span>
                    <div className="recorder-track-buttons">
                      <button type="button" className={`icon-button ${track.muted ? "is-on" : ""}`} onClick={() => updateTrack(track.id, { muted: !track.muted })} aria-pressed={track.muted} aria-label={`השתק את ${track.name}`} title="השתק">
                        {track.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                      </button>
                      <button type="button" className={`icon-button ${track.solo ? "is-on" : ""}`} onClick={() => updateTrack(track.id, { solo: !track.solo })} aria-pressed={track.solo} aria-label={`סולו ל${track.name}`} title="סולו">
                        <Headphones size={15} />
                      </button>
                      <button type="button" className="icon-button is-danger" onClick={() => removeTrack(track.id)} disabled={recordingNow} aria-label={`מחק את ${track.name}`} title="מחק">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="recorder-lane" dir="ltr">
                    <svg className="recorder-wave" viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`} preserveAspectRatio="none" style={{ inlineSize: `${width}%` }} aria-hidden="true">
                      <path d={track.path} />
                    </svg>
                    {playhead !== null && <span className="recorder-playhead" style={{ insetInlineStart: `${playhead * 100}%` }} />}
                  </div>
                  <div className="recorder-track-controls">
                    <label>
                      <span>
                        עוצמה <b dir="ltr">{Math.round(track.gain * 100)}%</b>
                      </span>
                      <input type="range" min={0} max={150} value={Math.round(track.gain * 100)} onChange={(event) => updateTrack(track.id, { gain: Number(event.target.value) / 100 })} aria-label={`עוצמה של ${track.name}`} />
                    </label>
                    <label>
                      <span>
                        פאן <b>{track.pan === 0 ? "מרכז" : track.pan < 0 ? `שמאל ${Math.round(-track.pan * 100)}` : `ימין ${Math.round(track.pan * 100)}`}</b>
                      </span>
                      <input type="range" min={-100} max={100} value={Math.round(track.pan * 100)} onChange={(event) => updateTrack(track.id, { pan: Number(event.target.value) / 100 })} onDoubleClick={() => updateTrack(track.id, { pan: 0 })} aria-label={`פאן של ${track.name}`} dir="ltr" />
                    </label>
                  </div>
                </div>
              );
            })}
            {anySolo && <p className="recorder-footnote">סולו פעיל: נשמעים רק הערוצים המסומנים באוזניות.</p>}
          </div>
        ) : (
          <div className="recorder-empty">
            <Layers size={22} />
            <p>
              אין עדיין ערוצים. לוחצים על המיקרופון ומקליטים את הערוץ הראשון — למשל גיטרה או קול מוביל — ואז מוסיפים עליו עוד שכבות.
              <span className="recorder-kbd-hint"> מקש הרווח מנגן ועוצר.</span>
            </p>
          </div>
        )}
      </div>

      <div className="settings-panel">
        <div className="settings-title">
          <Timer size={18} />
          מטרונום ותזמון
        </div>
        <div className="settings-grid">
          <label className="setting-field">
            <span>
              קצב <b dir="ltr">{settings.bpm} BPM</b>
            </span>
            <input type="range" min={40} max={240} value={settings.bpm} onChange={(event) => updateSettings({ bpm: clampBpm(Number(event.target.value)) })} disabled={recordingNow} dir="ltr" aria-label="קצב המטרונום" />
          </label>
          <div className="setting-field">
            <span>משקל</span>
            <div className="segmented-control" role="group" aria-label="משקל">
              {([3, 4] as const).map((beats) => (
                <button key={beats} type="button" className={settings.beatsPerBar === beats ? "active" : ""} onClick={() => updateSettings({ beatsPerBar: beats })} disabled={recordingNow} aria-pressed={settings.beatsPerBar === beats}>
                  <span dir="ltr">{beats}/4</span>
                </button>
              ))}
            </div>
          </div>
          <div className="setting-field">
            <span>ספירה לפני ההקלטה</span>
            <div className="segmented-control" role="group" aria-label="ספירה לפני ההקלטה">
              {[0, 1, 2].map((bars) => (
                <button key={bars} type="button" className={settings.countIn === bars ? "active" : ""} onClick={() => updateSettings({ countIn: bars })} disabled={recordingNow} aria-pressed={settings.countIn === bars}>
                  {bars === 0 ? "בלי" : bars === 1 ? "תיבה" : "2 תיבות"}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-field">
            <span>
              קליק <b dir="ltr">{Math.round(settings.clickVolume * 100)}%</b>
            </span>
            <label className="checkbox-field">
              <input type="checkbox" checked={settings.click} onChange={(event) => updateSettings({ click: event.target.checked })} disabled={recordingNow} />
              מטרונום גם בזמן ההקלטה
            </label>
            <input type="range" min={0} max={100} value={Math.round(settings.clickVolume * 100)} onChange={(event) => updateSettings({ clickVolume: Number(event.target.value) / 100 })} disabled={recordingNow} dir="ltr" aria-label="עוצמת הקליק" />
          </div>
          <label className="setting-field recorder-latency">
            <span>
              תיקון השהיה <b dir="ltr">{latencyOffset > 0 ? `+${latencyOffset}` : latencyOffset} ms</b>
            </span>
            <input type="range" min={MIN_LATENCY_OFFSET_MS} max={MAX_LATENCY_OFFSET_MS} step={1} value={latencyOffset} onChange={(event) => updateLatencyOffset(Number(event.target.value))} disabled={recordingNow} dir="ltr" aria-label="תיקון השהיה במילישניות" />
            <small>
              השהיית הכרטיס {measuredLatency === null ? "המשוערת" : "שנמדדה"}: <bdi dir="ltr">{Math.round(autoLatency * 1000)} ms</bdi> · סך הכול מוזז אחורה: <bdi dir="ltr">{totalLatencyMs} ms</bdi>. אם הערוץ החדש נשמע מאחר — הגדילו; אם הוא מקדים — הקטינו.
            </small>
            {latencyOffset !== 0 && (
              <button type="button" className="link-button recorder-reset" onClick={() => updateLatencyOffset(0)}>
                אפס את התיקון
              </button>
            )}
          </label>
        </div>
      </div>

      {tracks.length > 0 && (
        <div className="downloads-card">
          <div>
            <span className="download-icon">
              <Download size={22} />
            </span>
            <div>
              <h3>ייצוא</h3>
              <p>כל הערוצים הנשמעים כמיקס סטריאו אחד, או כל ערוץ כקובץ נפרד למיקסר.</p>
            </div>
          </div>
          <div className="download-buttons">
            <button type="button" onClick={() => void exportMix()} disabled={busy !== null || recordingNow}>
              <Download size={17} />
              <span>
                {busy === "export" ? "מייצא…" : "הורד מיקס"}
                <small>WAV סטריאו</small>
              </span>
            </button>
            <button type="button" onClick={() => void sendToMixer()} disabled={busy !== null || recordingNow}>
              <Layers size={17} />
              <span>
                {busy === "handoff" ? "מעביר…" : "שלח למיקסר"}
                <small>כל ערוץ כקובץ WAV</small>
              </span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
