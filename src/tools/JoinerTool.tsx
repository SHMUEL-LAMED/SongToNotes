import { ArrowDown, ArrowUp, Combine, Download, GripVertical, Layers, Loader2, Play, Scissors, Smartphone, Square, Trash2, UploadCloud, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACCEPTED_EXTENSIONS, AudioFileProblem, formatBytes, openAudioFile } from "../components/AudioPicker";
import { Transport } from "../components/Transport";
import { buildPeaks, formatTime, getOfflineAudioContextClass } from "../lib/audio";
import { BITRATES, encodeMp3 } from "../lib/convert";
import { downloadFile, safeFilename } from "../lib/export";
import { useOfferResult } from "../lib/currentFile";
import { handOffTo, hasHandoff, takeHandoffFiles } from "../lib/handoff";
import { MAX_TRANSITION_SECONDS, clampTransitionSeconds, clampTrim, joinPcmSteps, layoutTimeline, moveItem, mp3SampleRate, outputFormat, type PcmClip, type Transition, type TransitionKind } from "../lib/joiner";
import { useAssistantTool } from "../lib/useAssistantTool";
import { encodeWav } from "../lib/wav";
import "./joiner.css";

const MAX_CLIPS = 12;
const HUES = [96, 200, 300, 30, 250, 150, 340, 60];
const ACCEPT = ["audio/*", "video/*", ...ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`)].join(",");

type Clip = {
  id: string;
  name: string;
  buffer: AudioBuffer;
  /** A coarse envelope for the card's small waveform, built once on add. */
  peaks: Float32Array;
  /** Trim, in seconds of the source file. */
  start: number;
  end: number;
  gain: number;
  hue: number;
};

type Format = "wav" | "mp3";

const TRANSITIONS: { kind: TransitionKind; label: string; hint: string }[] = [
  { kind: "none", label: "בלי", hint: "הקבצים מתחברים צמוד, אחד אחרי השני." },
  { kind: "crossfade", label: "מעבר רך", hint: "הסוף של קובץ נבלע בתחילת הבא — בלי קפיצה בעוצמה." },
  { kind: "gap", label: "שקט", hint: "שקט מוחלט בין קובץ לקובץ." },
];

/** m:ss.d — trims are set to a tenth of a second, so the label says so. */
function formatPrecise(seconds: number) {
  const tenths = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${minutes}:${rest}`;
}

/**
 * An AudioBuffer around joined channels, for the preview transport. The
 * constructor is missing on older Safari, where an offline context's
 * createBuffer does the same job.
 */
function toAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer | null {
  const length = channels[0]?.length ?? 0;
  if (!length) return null;
  let buffer: AudioBuffer;
  try {
    buffer = new AudioBuffer({ length, numberOfChannels: channels.length, sampleRate });
  } catch {
    const Offline = getOfflineAudioContextClass();
    if (!Offline) return null;
    buffer = new Offline(channels.length, 1, sampleRate).createBuffer(channels.length, length, sampleRate);
  }
  channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
  return buffer;
}

/**
 * A pause that lets the page paint and handle input. A message on a channel
 * comes back sooner than setTimeout(0), which browsers stretch to 4 ms once
 * timeouts nest.
 */
function yieldToPage() {
  return new Promise<void>((resolve) => {
    if (typeof MessageChannel === "undefined") {
      window.setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

const WAVE_WIDTH = 1000;
const WAVE_HEIGHT = 64;

type TrimmerProps = {
  name: string;
  peaks: Float32Array;
  duration: number;
  start: number;
  end: number;
  onChange: (start: number, end: number, moving: "start" | "end") => void;
  /** Where the clip preview started (seconds) and a clock to measure from it; null when silent. */
  playback: { from: number; startedAt: number } | null;
  clock: () => number;
};

/**
 * A small waveform with two always-visible trim handles. The shared Waveform
 * draws a region by dragging across it, which is right for picking a loop
 * out of a song but wrong here: every clip starts fully selected and the
 * visitor only nudges its edges, so the handles are real sliders (role
 * "slider", arrow keys, Shift for whole seconds, Home/End) that can also be
 * dragged with a finger or a mouse.
 */
function ClipTrimmer({ name, peaks, duration, start, end, onChange, playback, clock }: TrimmerProps) {
  const cursorRef = useRef<HTMLDivElement>(null);

  const path = useMemo(() => {
    const buckets = peaks.length / 2;
    const step = WAVE_WIDTH / Math.max(1, buckets - 1);
    const top: string[] = [];
    const bottom: string[] = [];
    for (let index = 0; index < buckets; index += 1) {
      const x = (index * step).toFixed(1);
      top.push(`${x},${(WAVE_HEIGHT / 2 - peaks[index * 2 + 1] * (WAVE_HEIGHT / 2 - 2)).toFixed(1)}`);
      bottom.push(`${x},${(WAVE_HEIGHT / 2 - peaks[index * 2] * (WAVE_HEIGHT / 2 - 2)).toFixed(1)}`);
    }
    return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
  }, [peaks]);

  // The preview cursor moves every frame; writing its style directly keeps
  // the whole list of cards from re-rendering sixty times a second.
  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    if (!playback) {
      cursor.style.display = "none";
      return;
    }
    cursor.style.display = "block";
    let frame = 0;
    const tick = () => {
      const at = playback.from + (clock() - playback.startedAt);
      cursor.style.left = `${Math.max(0, Math.min(100, (at / duration) * 100))}%`;
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [playback, clock, duration]);

  // Measured from the handle's parent (the strip) at the moment of the move.
  const timeAt = (strip: Element | null, clientX: number) => {
    const bounds = strip?.getBoundingClientRect();
    if (!bounds || !bounds.width) return 0;
    return Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) * duration;
  };

  const move = (edge: "start" | "end", value: number) => {
    if (edge === "start") onChange(Math.min(value, end), end, "start");
    else onChange(start, Math.max(value, start), "end");
  };

  const handleProps = (edge: "start" | "end") => {
    const value = edge === "start" ? start : end;
    return {
      role: "slider",
      tabIndex: 0,
      "aria-label": `${edge === "start" ? "תחילת" : "סוף"} החיתוך של ${name}`,
      "aria-valuemin": 0,
      "aria-valuemax": Number(duration.toFixed(1)),
      "aria-valuenow": Number(value.toFixed(1)),
      "aria-valuetext": formatPrecise(value),
      "aria-orientation": "horizontal" as const,
      className: `joiner-handle is-${edge}`,
      style: { left: `${(value / duration) * 100}%` },
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        move(edge, timeAt(event.currentTarget.parentElement, event.clientX));
      },
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 1 : 0.1;
        // The strip runs left to right like a clock, whatever the page's
        // direction, so right (and up) always means later.
        const next: Record<string, number> = {
          ArrowRight: value + step,
          ArrowUp: value + step,
          ArrowLeft: value - step,
          ArrowDown: value - step,
          PageUp: value + 5,
          PageDown: value - 5,
          Home: edge === "start" ? 0 : start,
          End: edge === "start" ? end : duration,
        };
        if (!(event.key in next)) return;
        event.preventDefault();
        move(edge, next[event.key]);
      },
    };
  };

  const startPct = (start / duration) * 100;
  const endPct = (end / duration) * 100;
  return (
    <div className="joiner-trim" dir="ltr">
      <svg viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={path} />
      </svg>
      <div className="joiner-trim-shade" style={{ left: 0, width: `${startPct}%` }} />
      <div className="joiner-trim-shade" style={{ left: `${endPct}%`, right: 0 }} />
      <div className="joiner-trim-window" style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }} />
      <div ref={cursorRef} className="joiner-trim-cursor" />
      <div {...handleProps("start")}>
        <span />
      </div>
      <div {...handleProps("end")}>
        <span />
      </div>
    </div>
  );
}

type CardProps = {
  clip: Clip;
  index: number;
  count: number;
  dragging: boolean;
  playback: { from: number; startedAt: number } | null;
  clock: () => number;
  onUpdate: (patch: Partial<Clip>) => void;
  onMove: (to: number, focus: string) => void;
  onRemove: () => void;
  onTogglePlay: () => void;
  onGripDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onGripMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onGripUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

function ClipCard({ clip, index, count, dragging, playback, clock, onUpdate, onMove, onRemove, onTogglePlay, onGripDown, onGripMove, onGripUp }: CardProps) {
  const duration = clip.buffer.duration;
  const trimmed = clip.start > 0.05 || clip.end < duration - 0.05;
  return (
    <li className={`joiner-clip ${dragging ? "is-dragging" : ""}`} data-clip={clip.id} style={{ "--clip-hue": clip.hue } as React.CSSProperties}>
      <div className="joiner-clip-head">
        <button
          type="button"
          className="joiner-grip"
          data-focus="grip"
          aria-label={`שינוי המיקום של ${clip.name} — גוררים, או חצים למעלה ולמטה`}
          title="גרירה לשינוי הסדר"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" && index > 0) {
              event.preventDefault();
              onMove(index - 1, "grip");
            } else if (event.key === "ArrowDown" && index < count - 1) {
              event.preventDefault();
              onMove(index + 1, "grip");
            }
          }}
        >
          <GripVertical size={18} />
        </button>
        <span className="joiner-clip-index" aria-hidden="true">
          {index + 1}
        </span>
        <div className="joiner-clip-title">
          <strong dir="auto" title={clip.name}>
            {clip.name}
          </strong>
          <small>
            {formatPrecise(clip.end - clip.start)}
            {trimmed ? ` מתוך ${formatTime(duration)}` : ""} · {(clip.buffer.sampleRate / 1000).toFixed(1)} kHz · {clip.buffer.numberOfChannels === 1 ? "מונו" : "סטריאו"}
          </small>
        </div>
        <div className="joiner-clip-actions">
          <button type="button" className={`icon-button ${playback ? "is-on" : ""}`} onClick={onTogglePlay} aria-label={playback ? `עצור את ${clip.name}` : `השמע את ${clip.name}`} aria-pressed={Boolean(playback)} title={playback ? "עצור" : "השמע את הקובץ (החלק החתוך)"}>
            {playback ? <Square size={15} /> : <Play size={16} />}
          </button>
          <button type="button" className="icon-button" data-focus="up" onClick={() => onMove(index - 1, "up")} disabled={index === 0} aria-label={`הזז את ${clip.name} למעלה`} title="למעלה">
            <ArrowUp size={16} />
          </button>
          <button type="button" className="icon-button" data-focus="down" onClick={() => onMove(index + 1, "down")} disabled={index === count - 1} aria-label={`הזז את ${clip.name} למטה`} title="למטה">
            <ArrowDown size={16} />
          </button>
          <button type="button" className="icon-button is-danger" onClick={onRemove} aria-label={`הסר את ${clip.name}`} title="הסרה">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <ClipTrimmer
        name={clip.name}
        peaks={clip.peaks}
        duration={duration}
        start={clip.start}
        end={clip.end}
        playback={playback}
        clock={clock}
        onChange={(start, end, moving) => {
          const next = clampTrim(start, end, duration, moving);
          onUpdate({ start: next.start, end: next.end });
        }}
      />

      <div className="joiner-clip-foot">
        <span className="joiner-clip-range">
          <Scissors size={13} aria-hidden="true" /> <span dir="ltr">{formatPrecise(clip.start)}–{formatPrecise(clip.end)}</span>
          {trimmed && (
            <button type="button" className="joiner-link" onClick={() => onUpdate({ start: 0, end: duration })}>
              בלי חיתוך
            </button>
          )}
        </span>
        <label className="joiner-gain">
          <span>
            עוצמה <b>{Math.round(clip.gain * 100)}%</b>
          </span>
          <input type="range" min={0} max={200} step={1} value={Math.round(clip.gain * 100)} onChange={(event) => onUpdate({ gain: Number(event.target.value) / 100 })} aria-label={`עוצמה של ${clip.name}`} />
        </label>
      </div>
    </li>
  );
}

/**
 * Several files in, one file out: put them in order, trim each one, choose
 * how one flows into the next, and download the join as WAV or MP3. Every
 * clip is brought to one shape first (the highest sample rate among them,
 * stereo if any is stereo) with an offline context, so the join itself is
 * plain sample arithmetic from src/lib/joiner.ts.
 */
export function JoinerTool() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [transition, setTransition] = useState<Transition>({ kind: "crossfade", seconds: 2 });
  const [format, setFormat] = useState<Format>("mp3");
  const [kbps, setKbps] = useState(192);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState<{ message: string; fraction: number } | null>(null);
  const [result, setResult] = useState<{ file: File; url: string; clips: Clip[]; transition: Transition; kbps: number } | null>(null);
  const [preview, setPreview] = useState<AudioBuffer | null>(null);
  const [clipPlayback, setClipPlayback] = useState<{ id: string; from: number; startedAt: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [handed, setHanded] = useState<File[] | null>(null);

  const listRef = useRef<HTMLOListElement>(null);
  const timelineCursorRef = useRef<HTMLDivElement>(null);
  const clipsRef = useRef(clips);
  // Each clip converted to the output's rate and channel count, keyed by the
  // clip, so trimming or reordering never pays for a resample again.
  const convertedRef = useRef(new Map<string, { key: string; channels: Float32Array[] }>());
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  // A file dropped on the home page ("join with other files") arrives here.
  useEffect(() => {
    if (!hasHandoff()) return;
    // Taking the files empties the hand-off, so a StrictMode re-run finds
    // nothing and cannot lose what the first run took.
    void takeHandoffFiles().then((files) => {
      if (files.length) setHanded(files);
    });
  }, []);

  useEffect(
    () => () => {
      previewSourceRef.current?.stop();
      void previewContextRef.current?.close().catch(() => undefined);
    },
    [],
  );

  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );

  const format0 = useMemo(() => outputFormat(clips.map((clip) => clip.buffer)), [clips]);
  const layout = useMemo(() => layoutTimeline(clips.map((clip) => clip.end - clip.start), transition), [clips, transition]);
  const total = layout.total;
  const requestedSeconds = clampTransitionSeconds(transition.seconds);
  const shortened = transition.kind === "crossfade" && layout.overlaps.some((overlap) => overlap < requestedSeconds - 0.005);
  const mixedShapes = clips.some((clip) => clip.buffer.sampleRate !== format0.sampleRate || clip.buffer.numberOfChannels !== format0.channels);
  const fresh = result && result.clips === clips && result.transition === transition ? result : null;

  /** One clip's channels at the output rate and channel count. */
  const convertClip = async (clip: Clip, sampleRate: number, channels: number): Promise<Float32Array[]> => {
    const key = `${sampleRate}/${channels}`;
    const cached = convertedRef.current.get(clip.id);
    if (cached?.key === key) return cached.channels;
    const buffer = clip.buffer;
    let converted: Float32Array[];
    if (buffer.sampleRate === sampleRate && buffer.numberOfChannels === channels) {
      converted = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
    } else {
      // The browser's own resampler and its speaker rules for upmixing
      // (mono to both sides) or folding down (5.1 to stereo): the same
      // quality the page plays with, and nothing to maintain here.
      const Offline = getOfflineAudioContextClass();
      if (!Offline) throw new Error("הדפדפן הזה אינו תומך בהמרת קצב הדגימה.");
      const offline = new Offline(channels, Math.max(1, Math.ceil(buffer.duration * sampleRate)), sampleRate);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      converted = Array.from({ length: channels }, (_, index) => rendered.getChannelData(index));
    }
    convertedRef.current.set(clip.id, { key, channels: converted });
    return converted;
  };

  /**
   * The whole join, at the output rate unless another is asked for (MP3 caps
   * it at 48 kHz). The sample work runs in slices with a pause between them,
   * so a few long files do not freeze the page on every edit; null when
   * `cancelled` says a newer edit has made this one moot.
   */
  const buildJoin = async (list: Clip[], how: Transition, rate?: number, cancelled: () => boolean = () => false, onProgress?: (fraction: number) => void) => {
    const shape = outputFormat(list.map((clip) => clip.buffer));
    const sampleRate = rate ?? shape.sampleRate;
    const pcm: PcmClip[] = [];
    for (const clip of list) {
      pcm.push({
        channels: await convertClip(clip, sampleRate, shape.channels),
        start: Math.round(clip.start * sampleRate),
        end: Math.round(clip.end * sampleRate),
        gain: clip.gain,
      });
      if (cancelled()) return null;
    }
    const steps = joinPcmSteps(pcm, how, sampleRate, shape.channels);
    for (;;) {
      const step = steps.next();
      if (step.done) return { channels: step.value, sampleRate };
      onProgress?.(step.value);
      await yieldToPage();
      if (cancelled()) return null;
    }
  };

  // The preview follows every change, a beat later, so dragging a handle
  // does not rebuild the join on every pointer move.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!clips.length) {
        setPreview(null);
        return;
      }
      void buildJoin(clips, transition, undefined, () => cancelled)
        .then((joined) => {
          if (joined && !cancelled) setPreview(toAudioBuffer(joined.channels, joined.sampleRate));
        })
        .catch((caught) => {
          if (!cancelled) setError(caught instanceof Error ? caught.message : "לא הצלחנו לבנות את התצוגה המקדימה.");
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // buildJoin reads only its arguments and the conversion cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, transition]);

  const addFiles = async (incoming: FileList | File[] | null, atStart = false) => {
    if (!incoming) return;
    const room = MAX_CLIPS - clipsRef.current.length;
    const list = Array.from(incoming).slice(0, Math.max(0, room));
    if (!list.length) {
      setError(`אפשר לחבר עד ${MAX_CLIPS} קבצים.`);
      return;
    }
    setLoading(true);
    setError(incoming.length > list.length ? `נוספו רק ${list.length} — אפשר לחבר עד ${MAX_CLIPS} קבצים.` : null);
    const added: Clip[] = [];
    for (const file of list) {
      try {
        const { buffer, note } = await openAudioFile(file);
        if (note) setError(`„${file.name}”: ${note}`);
        if (!buffer.length) throw new Error("empty");
        const clip: Clip = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name.replace(/\.[^/.]+$/, "") || "קובץ",
          buffer,
          peaks: buildPeaks(buffer, 240),
          start: 0,
          end: buffer.duration,
          gain: 1,
          hue: 0,
        };
        // Captured now: the updater below may run after later files are added.
        const position = added.length;
        added.push(clip);
        // Cards appear one by one, so a long batch visibly makes progress.
        // A hand-off goes to the front, in its own order.
        setClips((current) => {
          // A second batch dropped while this one is still opening counted
          // its room from a list that had not grown yet; the cap holds here.
          if (current.length >= MAX_CLIPS) return current;
          const withHue = { ...clip, hue: HUES[current.length % HUES.length] };
          return atStart ? [...current.slice(0, position), withHue, ...current.slice(position)] : [...current, withHue];
        });
      } catch (caught) {
        setError(
          caught instanceof AudioFileProblem
            ? `„${file.name}”: ${caught.message}`
            : `לא הצלחנו לפתוח את „${file.name}”. ייתכן שהקובץ פגום או בפורמט שהדפדפן לא מכיר.`,
        );
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!handed) return;
    const files = handed;
    const timer = window.setTimeout(() => {
      setHanded(null);
      void addFiles(files, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [handed]);

  const update = (id: string, patch: Partial<Clip>) => {
    setClips((current) => current.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)));
  };

  const stopClip = () => {
    const source = previewSourceRef.current;
    previewSourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    setClipPlayback(null);
  };

  const remove = (id: string) => {
    if (clipPlayback?.id === id) stopClip();
    convertedRef.current.delete(id);
    setClips((current) => current.filter((clip) => clip.id !== id));
  };

  /** Moves a clip, then puts focus back on the control that moved it. */
  const moveClip = (from: number, to: number, focus?: string) => {
    const id = clips[from]?.id;
    setClips((current) => moveItem(current, from, to));
    if (!id || !focus) return;
    requestAnimationFrame(() => {
      const card = listRef.current?.querySelector<HTMLElement>(`[data-clip="${id}"]`);
      const wanted = card?.querySelector<HTMLButtonElement>(`[data-focus="${focus}"]`);
      // An arrow that just reached the end of the list is disabled; the
      // grip is always there to take the focus instead.
      (wanted && !wanted.disabled ? wanted : card?.querySelector<HTMLButtonElement>('[data-focus="grip"]'))?.focus();
    });
  };

  const clock = () => previewContextRef.current?.currentTime ?? 0;

  const playClip = async (clip: Clip) => {
    stopClip();
    const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    if (!previewContextRef.current) previewContextRef.current = new Context();
    const context = previewContextRef.current;
    if (context.state === "suspended") await context.resume();
    const source = context.createBufferSource();
    source.buffer = clip.buffer;
    const gain = context.createGain();
    gain.gain.value = clip.gain;
    source.connect(gain).connect(context.destination);
    source.onended = () => {
      if (previewSourceRef.current !== source) return;
      previewSourceRef.current = null;
      setClipPlayback(null);
    };
    source.start(0, clip.start, Math.max(0.01, clip.end - clip.start));
    previewSourceRef.current = source;
    setClipPlayback({ id: clip.id, from: clip.start, startedAt: context.currentTime });
  };

  // Drag to reorder, on pointer events rather than HTML drag and drop, which
  // phones do not fire. A card swaps with a neighbour once the pointer passes
  // that neighbour's middle; measured against the neighbour, not the dragged
  // card, so cards of different heights cannot bounce back and forth.
  const gripDown = (id: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(id);
  };
  const gripMove = (id: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (draggingId !== id || !listRef.current) return;
    const cards = Array.from(listRef.current.children) as HTMLElement[];
    const from = cards.findIndex((card) => card.dataset.clip === id);
    if (from < 0) return;
    let to = from;
    for (let index = from - 1; index >= 0; index -= 1) {
      const bounds = cards[index].getBoundingClientRect();
      if (event.clientY < bounds.top + bounds.height / 2) to = index;
      else break;
    }
    for (let index = from + 1; index < cards.length; index += 1) {
      const bounds = cards[index].getBoundingClientRect();
      if (event.clientY > bounds.top + bounds.height / 2) to = index;
      else break;
    }
    if (to !== from) setClips((current) => moveItem(current, from, to));
  };
  const gripUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDraggingId(null);
  };

  const baseName = () => `${safeFilename(clips.map((clip) => clip.name).join("+").slice(0, 60)) || "joined"}-joined`;

  // The joined file, not the first clip, is what goes on to the next tool.
  useOfferResult(clips.length > 1 ? preview : null, `${baseName()}.wav`, () => {
    const joined = preview!;
    const channels = Array.from({ length: joined.numberOfChannels }, (_, index) => joined.getChannelData(index));
    return new File([encodeWav({ channels, sampleRate: joined.sampleRate })], `${baseName()}.wav`, { type: "audio/wav" });
  });

  /** Renders the join as a file; downloads it unless told otherwise. */
  const exportJoin = async (as: Format, download = true): Promise<File | null> => {
    if (!clips.length || busyRef.current) return null;
    // An MP3 made at another quality is not what was asked for now.
    if (fresh && fresh.file.name.endsWith(`.${as}`) && (as === "wav" || fresh.kbps === kbps)) {
      if (download) downloadFile(fresh.file, fresh.file.name, fresh.file.type);
      return fresh.file;
    }
    busyRef.current = true;
    const list = clips;
    const how = transition;
    setError(null);
    setBusy({ message: "מחבר את הקבצים…", fraction: 0.05 });
    try {
      const shape = outputFormat(list.map((clip) => clip.buffer));
      // MP3 carries at most 48 kHz; a 96 kHz join is rendered straight at
      // 48 kHz for it instead of being resampled twice.
      const rate = as === "mp3" ? mp3SampleRate(shape.sampleRate) : shape.sampleRate;
      const joined = await buildJoin(list, how, rate, undefined, (fraction) =>
        setBusy({ message: "מחבר את הקבצים…", fraction: 0.05 + fraction * (as === "wav" ? 0.6 : 0.15) }),
      );
      if (!joined) return null;
      const { channels, sampleRate } = joined;
      let file: File;
      if (as === "wav") {
        setBusy({ message: "כותב WAV…", fraction: 0.7 });
        file = new File([encodeWav({ channels, sampleRate })], `${baseName()}.wav`, { type: "audio/wav" });
      } else {
        setBusy({ message: "מקודד MP3…", fraction: 0.2 });
        const bytes = await encodeMp3(channels, sampleRate, kbps, (fraction) => setBusy({ message: "מקודד MP3…", fraction: 0.2 + fraction * 0.78 }));
        file = new File([bytes], `${baseName()}.mp3`, { type: "audio/mpeg" });
      }
      setResult({ file, url: URL.createObjectURL(file), clips: list, transition: how, kbps });
      if (download) downloadFile(file, file.name, file.type);
      return file;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "החיבור נכשל.");
      return null;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const sendTo = async (tool: "ringtone" | "convert" | "mixer") => {
    // Another tool works best from lossless audio, so the hand-off is a WAV
    // unless a fresh file of either kind is already sitting here.
    const file = fresh ? fresh.file : await exportJoin("wav", false);
    if (file) await handOffTo(tool, file, "הקובץ המחובר");
  };

  const setTransitionKind = (kind: TransitionKind) => setTransition((current) => ({ ...current, kind }));
  const setTransitionSeconds = (seconds: number) => setTransition((current) => ({ ...current, seconds: clampTransitionSeconds(seconds) }));

  const describeTransition = (how: Transition) =>
    how.kind === "none" ? "בלי מעבר" : how.kind === "crossfade" ? `מעבר רך של ${clampTransitionSeconds(how.seconds).toFixed(1)} ש׳` : `שקט של ${clampTransitionSeconds(how.seconds).toFixed(1)} ש׳`;

  useAssistantTool("joiner", {
    state: () =>
      clips.length
        ? `חיבור קבצים: ${clips.length} קבצים — ${clips
            .map((clip, index) => `${index + 1}. „${clip.name}” (${formatPrecise(clip.start)}–${formatPrecise(clip.end)} מתוך ${formatTime(clip.buffer.duration)}${clip.gain !== 1 ? `, עוצמה ${Math.round(clip.gain * 100)}%` : ""})`)
            .join("; ")}; ${describeTransition(transition)}; אורך כולל ${formatPrecise(total)}; פורמט ${format.toUpperCase()}${busy ? "; מעבד" : ""}${fresh ? `; קובץ מוכן: ${fresh.file.name}` : ""}.`
        : "חיבור קבצים: עדיין אין קבצים (רק הגולש מוסיף קבצים).",
    handlers: {
      "joiner.list": () => ({
        ok: true,
        message: clips.length ? `${clips.length} קבצים, אורך כולל ${formatPrecise(total)}` : "אין עדיין קבצים",
        data: {
          clips: clips.map((clip, index) => ({
            index: index + 1,
            name: clip.name,
            duration: Number(clip.buffer.duration.toFixed(2)),
            trimStart: Number(clip.start.toFixed(2)),
            trimEnd: Number(clip.end.toFixed(2)),
            length: Number((clip.end - clip.start).toFixed(2)),
            startsAt: Number((layout.starts[index] ?? 0).toFixed(2)),
            gain: Math.round(clip.gain * 100),
          })),
          transition: { kind: transition.kind, seconds: requestedSeconds, applied: (transition.kind === "crossfade" ? layout.overlaps : layout.gaps).map((value) => Number(value.toFixed(2))) },
          total: Number(total.toFixed(2)),
          output: { sampleRate: format0.sampleRate, channels: format0.channels },
          format,
          kbps,
        },
      }),
      "joiner.set": ({ transition: kind, seconds }) => {
        const next: Transition = { ...transition };
        if (kind !== undefined) {
          if (kind !== "none" && kind !== "crossfade" && kind !== "gap") return { ok: false, message: "סוג המעבר הוא crossfade, gap או none" };
          next.kind = kind;
        }
        if (seconds !== undefined) {
          if (typeof seconds !== "number" || !Number.isFinite(seconds)) return { ok: false, message: "משך המעבר צריך להיות מספר שניות (0..10)" };
          next.seconds = clampTransitionSeconds(seconds);
        }
        if (kind === undefined && seconds === undefined) return { ok: false, message: "לא צוין מה לשנות" };
        setTransition(next);
        const nextTotal = layoutTimeline(clips.map((clip) => clip.end - clip.start), next).total;
        return { ok: true, message: `${describeTransition(next)} בין הקבצים${clips.length > 1 ? `; האורך הכולל ${formatPrecise(nextTotal)}` : ""}` };
      },
      "joiner.export": async ({ format: wanted }) => {
        if (!clips.length) return { ok: false, message: "אין קבצים לחבר — קודם מוסיפים קבצים" };
        if (busyRef.current) return { ok: false, message: "כבר מעבד" };
        if (wanted !== undefined && wanted !== "wav" && wanted !== "mp3") return { ok: false, message: "הפורמט הוא wav או mp3" };
        const as: Format = wanted ?? format;
        setFormat(as);
        const file = await exportJoin(as);
        return file ? { ok: true, message: `${file.name} ירד (${formatBytes(file.size)}, ${formatPrecise(total)})` } : { ok: false, message: "החיבור נכשל" };
      },
    },
  });

  const transitionInfo = TRANSITIONS.find((item) => item.kind === transition.kind) ?? TRANSITIONS[0];

  return (
    <section className="tool-body joiner-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Combine size={26} />
        </span>
        <div>
          <h1>חיבור וחיתוך קבצים</h1>
          <p>כמה קבצי שמע לקובץ אחד — מסדרים, חותכים כל אחד, בוחרים מעבר רך או שקט ביניהם, ומורידים WAV או MP3.</p>
        </div>
      </div>

      <div className="workspace-card">
        <div
          className={`drop-zone joiner-drop ${clips.length ? "is-compact" : ""} ${dropping ? "is-dragging" : ""}`}
          aria-disabled={loading || clips.length >= MAX_CLIPS}
          onDragOver={(event) => {
            event.preventDefault();
            if (!dropping) setDropping(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDropping(false);
            void addFiles(event.dataTransfer.files);
          }}
        >
          <input
            type="file"
            accept={ACCEPT}
            multiple
            className="native-file-input"
            aria-label={clips.length ? "הוספת עוד קבצים" : "בחירת קבצי שמע לחיבור"}
            disabled={loading || clips.length >= MAX_CLIPS}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              // Cleared so choosing the same file again (to repeat it) still fires.
              event.target.value = "";
              void addFiles(files);
            }}
          />
          <span className="upload-icon">{loading ? <Loader2 size={clips.length ? 20 : 28} className="joiner-spin" /> : <UploadCloud size={clips.length ? 20 : 28} />}</span>
          <strong>{loading ? "פותח את הקבצים…" : clips.length ? "הוספת עוד קבצים" : "בוחרים או גוררים לכאן כמה קבצי שמע"}</strong>
          <span>
            {clips.length ? `${clips.length}/${MAX_CLIPS} · ` : ""}MP3, WAV, M4A, OGG, FLAC ועוד · הקבצים לא יוצאים מהמכשיר
          </span>
        </div>

        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {clips.length > 0 && (
          <>
            <ol className="joiner-clips" ref={listRef} aria-label="הקבצים לפי הסדר">
              {clips.map((clip, index) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  index={index}
                  count={clips.length}
                  dragging={draggingId === clip.id}
                  playback={clipPlayback?.id === clip.id ? clipPlayback : null}
                  clock={clock}
                  onUpdate={(patch) => update(clip.id, patch)}
                  onMove={(to, focus) => moveClip(index, to, focus)}
                  onRemove={() => remove(clip.id)}
                  onTogglePlay={() => (clipPlayback?.id === clip.id ? stopClip() : void playClip(clip))}
                  onGripDown={gripDown(clip.id)}
                  onGripMove={gripMove(clip.id)}
                  onGripUp={gripUp}
                />
              ))}
            </ol>
            {clips.length === 1 && <p className="joiner-hint">מוסיפים עוד קובץ אחד לפחות כדי לחבר. אפשר גם להשתמש בקובץ יחיד רק כדי לחתוך אותו.</p>}

            <div className="settings-panel">
              <div className="settings-grid">
                <div className="setting-field">
                  <span id="joiner-transition">מעבר בין הקבצים</span>
                  <div className="segmented-control" role="group" aria-labelledby="joiner-transition">
                    {TRANSITIONS.map((item) => (
                      <button key={item.kind} type="button" className={transition.kind === item.kind ? "active" : ""} aria-pressed={transition.kind === item.kind} onClick={() => setTransitionKind(item.kind)}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <small>{transitionInfo.hint}</small>
                </div>
                {transition.kind !== "none" && (
                  <label className="setting-field range-field">
                    <span>
                      {transition.kind === "crossfade" ? "משך המעבר" : "משך השקט"} <b>{requestedSeconds.toFixed(1)} ש׳</b>
                    </span>
                    <input type="range" min={0} max={MAX_TRANSITION_SECONDS} step={0.1} value={requestedSeconds} onChange={(event) => setTransitionSeconds(Number(event.target.value))} aria-label={transition.kind === "crossfade" ? "משך המעבר בשניות" : "משך השקט בשניות"} />
                    {shortened && <small>בין קבצים קצרים המעבר מתקצר לחצי מאורך הקובץ הקצר, כדי שלא יבלע אותו.</small>}
                  </label>
                )}
                <div className="setting-field">
                  <span id="joiner-format">פורמט הקובץ</span>
                  <div className="segmented-control" role="group" aria-labelledby="joiner-format">
                    <button type="button" className={format === "mp3" ? "active" : ""} aria-pressed={format === "mp3"} onClick={() => setFormat("mp3")}>
                      MP3
                    </button>
                    <button type="button" className={format === "wav" ? "active" : ""} aria-pressed={format === "wav"} onClick={() => setFormat("wav")}>
                      WAV
                    </button>
                  </div>
                  <small>
                    {format === "mp3" ? "קטן ונפוץ, מתאים לטלפון ולשיתוף." : "ללא דחיסה — איכות מלאה, קובץ גדול."} הפלט: {((format === "mp3" ? mp3SampleRate(format0.sampleRate) : format0.sampleRate) / 1000).toFixed(1)} kHz, {format0.channels === 2 ? "סטריאו" : "מונו"}
                    {mixedShapes ? " (קבצים אחרים יומרו אליו)" : ""}.
                  </small>
                </div>
                {format === "mp3" && (
                  <label className="setting-field">
                    <span>איכות MP3</span>
                    <select value={kbps} onChange={(event) => setKbps(Number(event.target.value))} aria-label="קצב סיביות">
                      {BITRATES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>

            <div className="joiner-preview">
              <div className="joiner-preview-head">
                <h2>הקובץ המחובר</h2>
                <span className="joiner-total">
                  אורך כולל <b>{formatPrecise(total)}</b>
                </span>
              </div>
              <div className="joiner-timeline" dir="ltr" role="img" aria-label={`ציר הזמן: ${clips.length} קבצים, ${describeTransition(transition)}, אורך כולל ${formatPrecise(total)}`}>
                {clips.map((clip, index) => (
                  <div
                    key={clip.id}
                    className={`joiner-timeline-block ${index % 2 ? "is-low" : ""}`}
                    style={{ "--clip-hue": clip.hue, left: `${total ? (layout.starts[index] / total) * 100 : 0}%`, width: `${total ? (layout.lengths[index] / total) * 100 : 0}%` } as React.CSSProperties}
                    title={`${index + 1}. ${clip.name}`}
                  >
                    <span>{index + 1}</span>
                  </div>
                ))}
                <div ref={timelineCursorRef} className="joiner-timeline-cursor" />
              </div>
              <Transport
                buffer={preview}
                label="נגן את הכול"
                onTime={(time) => {
                  const cursor = timelineCursorRef.current;
                  if (cursor) cursor.style.left = `${total ? Math.min(100, (time / total) * 100) : 0}%`;
                }}
              />
            </div>

            {!busy && (
              <button className="primary-button" type="button" onClick={() => void exportJoin(format)} disabled={!clips.length}>
                <Wand2 size={20} /> {clips.length > 1 ? "חבר והורד" : "חתוך והורד"} {format.toUpperCase()}
                <small>
                  {formatPrecise(total)} · בערך {formatBytes(format === "mp3" ? (total * kbps * 1000) / 8 : total * format0.sampleRate * format0.channels * 2 + 44)}
                </small>
              </button>
            )}
            {busy && (
              <div className="processing-box" aria-live="polite">
                <div className="processing-top">
                  <span>
                    <Wand2 size={18} /> {busy.message}
                  </span>
                  <strong>{Math.round(busy.fraction * 100)}%</strong>
                </div>
                <div className="progress-track" role="progressbar" aria-label="התקדמות החיבור" aria-valuenow={Math.round(busy.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${Math.max(2, busy.fraction * 100)}%` }} />
                </div>
              </div>
            )}

            <div className="downloads-card joiner-result">
              <div>
                <span className="download-icon">
                  <Download size={22} />
                </span>
                <div>
                  <h3>{fresh ? fresh.file.name : "להמשיך בכלי אחר"}</h3>
                  <p>{fresh ? `${formatBytes(fresh.file.size)} · ${fresh.file.name.endsWith(".mp3") ? `MP3 ${fresh.kbps} kbps` : "WAV"}` : "הקובץ המחובר נשלח ישר לכלי הבא, בלי להוריד ולהעלות מחדש."}</p>
                </div>
              </div>
              <div className="download-buttons">
                {fresh && (
                  <button type="button" onClick={() => downloadFile(fresh.file, fresh.file.name, fresh.file.type)}>
                    <Download size={17} />
                    <span>
                      הורד שוב<small>{fresh.file.name.endsWith(".mp3") ? "MP3" : "WAV"}</small>
                    </span>
                  </button>
                )}
                <button type="button" onClick={() => void sendTo("ringtone")} disabled={Boolean(busy)}>
                  <Smartphone size={17} />
                  <span>
                    לצלצול<small>כלי הצלצולים</small>
                  </span>
                </button>
                <button type="button" onClick={() => void sendTo("convert")} disabled={Boolean(busy)}>
                  <Combine size={17} />
                  <span>
                    להמרה<small>פורמט ואיכות אחרים</small>
                  </span>
                </button>
                <button type="button" onClick={() => void sendTo("mixer")} disabled={Boolean(busy)}>
                  <Layers size={17} />
                  <span>
                    למיקסר<small>עם עוד ערוצים</small>
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
