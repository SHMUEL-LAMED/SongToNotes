import { Circle, Download, Drum, Keyboard, Layers, LoaderCircle, Minus, Play, Plus, Square, Timer, Trash2, Undo2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { MidiButton } from "../components/MidiButton";
import {
  BEATS_PER_BAR,
  DRUMS,
  KEY_MAP,
  KITS,
  LOOP_BARS,
  MAX_BPM,
  MIN_BPM,
  DrumSynth,
  clicksInWindow,
  countEvents,
  drumForCode,
  drumForMidiNote,
  freeLoopBeats,
  isDrumId,
  isKitId,
  loopEventsInWindow,
  masterChain,
  normalizeSettings,
  placeHit,
  renderDrumLoop,
  secondsPerBeat,
  serializeSettings,
  velocityFromPosition,
  wrapBeat,
  type DrumId,
  type DrumInfo,
  type KitId,
  type LoopEvent,
  type LoopLength,
  type Take,
  type Zone,
} from "../lib/drumKit";
import { downloadFile } from "../lib/export";
import { handOffTo } from "../lib/handoff";
import { useMidiInput } from "../lib/midiInput";
import { useAssistantTool } from "../lib/useAssistantTool";
import { encodeWav, fromAudioBuffer } from "../lib/wav";
import "./drumkit.css";

const STORAGE_KEY = "musictools.drumkit.v1";
/** How far ahead of the audio clock the loop and the click are scheduled. */
const LOOKAHEAD = 0.12;

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeSettings(null);
  }
}

/**
 * The live side: one AudioContext tuned for the shortest latency, the hits
 * played the instant they come in, and a scheduler on the audio clock for the
 * metronome and the recorded loop. Everything is counted in beats from
 * `origin`, the audio time of beat 0.
 */
class KitEngine {
  context: AudioContext | null = null;
  private master: GainNode | null = null;
  private synth: DrumSynth | null = null;
  private timer: number | null = null;
  private scheduled = 0;
  origin = 0;
  kit: KitId;
  volume: number;
  bpm: number;
  metronome = false;
  playing = false;
  loopBeats: number | null = null;
  loopStart = 0;
  events: LoopEvent[] = [];
  /** A recorded hit is about to sound, `delay` ms from now — for the pad's flash. */
  onScheduledHit: ((drum: DrumId, velocity: number, delay: number) => void) | null = null;

  constructor(settings: { kit: KitId; volume: number; bpm: number }) {
    this.kit = settings.kit;
    this.volume = settings.volume;
    this.bpm = settings.bpm;
  }

  get running() {
    return this.timer !== null;
  }

  /** The beat up to which everything has been scheduled already. */
  get horizon() {
    return this.scheduled;
  }

  ensure() {
    if (!this.context) {
      const AudioContextClass =
        window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("הדפדפן הזה אינו תומך בשמע.");
      try {
        this.context = new AudioContextClass({ latencyHint: "interactive" });
      } catch {
        this.context = new AudioContextClass();
      }
      this.master = masterChain(this.context, this.volume);
      this.synth = new DrumSynth(this.context, this.master);
    }
    if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
    return this.context;
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.context && this.master) this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
  }

  /** A new tempo, keeping the place in the bar where it is. */
  setBpm(bpm: number) {
    if (this.context && this.running) {
      const now = this.context.currentTime;
      const beat = this.beatAt(now);
      this.bpm = bpm;
      this.origin = now - beat * secondsPerBeat(bpm);
    } else {
      this.bpm = bpm;
    }
  }

  beatAt(time: number) {
    return (time - this.origin) / secondsPerBeat(this.bpm);
  }

  timeAt(beat: number) {
    return this.origin + beat * secondsPerBeat(this.bpm);
  }

  currentBeat() {
    return this.context && this.running ? this.beatAt(this.context.currentTime) : null;
  }

  /** Plays a drum right now; returns the audio time it sounds at. */
  hit(drum: DrumId, velocity: number, zone: Zone) {
    const context = this.ensure();
    const time = context.currentTime;
    this.synth!.play(drum, this.kit, time, velocity, zone);
    return time;
  }

  /** Starts the clock with beat 0 `lead` seconds from now (a bar, for a count-in). */
  start(lead: number) {
    const context = this.ensure();
    if (this.running) return;
    this.origin = context.currentTime + lead;
    this.scheduled = this.beatAt(context.currentTime);
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  dispose() {
    this.stop();
    this.onScheduledHit = null;
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }

  private tick() {
    const context = this.context;
    if (!context || !this.synth) return;
    const now = context.currentTime;
    // After the tab slept, pick up from now instead of firing a backlog.
    const from = Math.max(this.scheduled, this.beatAt(now - 0.03));
    const to = this.beatAt(now + LOOKAHEAD);
    if (to <= from) return;
    for (const click of clicksInWindow(from, to)) {
      // Before beat 0 is the count-in, which clicks even with the metronome off.
      if (this.metronome || click.beat < 0) this.click(this.timeAt(click.beat), click.accent);
    }
    if (this.playing && this.loopBeats) {
      for (const { event, beat } of loopEventsInWindow(this.events, this.loopBeats, this.loopStart, from, to)) {
        const time = this.timeAt(beat);
        if (event.notBefore !== undefined && time <= event.notBefore) continue;
        this.synth.play(event.drum, this.kit, time, event.velocity, event.zone);
        this.onScheduledHit?.(event.drum, event.velocity, Math.max(0, (time - now) * 1000));
      }
    }
    this.scheduled = to;
  }

  private click(time: number, accent: boolean) {
    const context = this.context!;
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = accent ? 1760 : 1175;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(time);
    osc.stop(time + 0.06);
  }
}

type Recording = { takeId: string; base: number; free: boolean };

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function describeLength(beats: number) {
  const bars = beats / BEATS_PER_BAR;
  if (Number.isInteger(bars)) return bars === 1 ? "תיבה אחת" : `${bars} תיבות`;
  return `${Math.round(beats * 100) / 100} פעמות`;
}

function clamp(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * An electronic drum kit to play live: ten drums laid out the way they stand
 * around a drummer, struck by touch (several fingers at once), mouse, keyboard
 * or a MIDI pad, harder in the middle and softer at the edge. What is played
 * can be recorded into a loop that keeps going round while more is layered on
 * top, and the loop renders to a WAV file or goes on to the mixer.
 */
export function DrumKitTool() {
  const [initial] = useState(readStored);
  const [kit, setKit] = useState<KitId>(initial.kit);
  const [volume, setVolume] = useState(initial.volume);
  const [bpm, setBpm] = useState(initial.bpm);
  const [click, setClick] = useState(initial.click);
  const [quantize, setQuantize] = useState(initial.quantize);
  const [countIn, setCountIn] = useState(initial.countIn);
  const [length, setLength] = useState<LoopLength>(initial.length);
  const [takes, setTakes] = useState<Take[]>(initial.takes);
  const [loopBeats, setLoopBeats] = useState<number | null>(initial.loopBeats);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [repeats, setRepeats] = useState(1);
  const [busy, setBusy] = useState<"download" | "mixer" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<KitEngine | null>(null);
  const takesRef = useRef<Take[]>(initial.takes);
  const loopBeatsRef = useRef<number | null>(initial.loopBeats);
  const recRef = useRef<Recording | null>(null);
  const quantizeRef = useRef(quantize);
  const padRefs = useRef(new Map<DrumId, HTMLButtonElement>());
  const progressRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const lightsRef = useRef<HTMLDivElement | null>(null);
  const flashTimers = useRef(new Set<number>());

  useEffect(() => {
    quantizeRef.current = quantize;
  }, [quantize]);

  const commitTakes = useCallback((next: Take[]) => {
    takesRef.current = next;
    setTakes(next);
    if (engineRef.current) engineRef.current.events = next.flatMap((take) => take.events);
  }, []);

  const commitLoopBeats = useCallback((next: number | null) => {
    loopBeatsRef.current = next;
    setLoopBeats(next);
    if (engineRef.current) engineRef.current.loopBeats = next;
  }, []);

  const flash = useCallback((drum: DrumId, velocity: number, point?: { x: number; y: number }) => {
    const pad = padRefs.current.get(drum);
    if (!pad || typeof pad.animate !== "function") return;
    pad.querySelector(".drumkit-glow")?.animate([{ opacity: 0.3 + 0.7 * velocity }, { opacity: 0 }], {
      duration: 340,
      easing: "cubic-bezier(0.2, 0.7, 0.3, 1)",
    });
    pad.querySelector(".drumkit-face")?.animate([{ transform: `scale(${1 - 0.06 * velocity})` }, { transform: "scale(1)" }], {
      duration: 200,
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    });
    if (point) {
      const ripple = document.createElement("span");
      ripple.className = "drumkit-ripple";
      ripple.style.left = `${point.x * 100}%`;
      ripple.style.top = `${point.y * 100}%`;
      pad.appendChild(ripple);
      const animation = ripple.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.15)", opacity: 0.85 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 0 },
        ],
        { duration: 450, easing: "ease-out" },
      );
      animation.onfinish = () => ripple.remove();
      animation.oncancel = () => ripple.remove();
    }
  }, []);

  const engine = useCallback(() => {
    if (!engineRef.current) {
      const created = new KitEngine({ kit, volume, bpm });
      created.metronome = click;
      created.loopBeats = loopBeatsRef.current;
      created.events = takesRef.current.flatMap((take) => take.events);
      created.onScheduledHit = (drum, velocity, delay) => {
        const timer = window.setTimeout(() => {
          flashTimers.current.delete(timer);
          flash(drum, velocity);
        }, delay);
        flashTimers.current.add(timer);
      };
      engineRef.current = created;
    }
    return engineRef.current;
    // The engine is made once; later changes reach it through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (engineRef.current) engineRef.current.kit = kit;
  }, [kit]);
  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);
  useEffect(() => {
    engineRef.current?.setBpm(bpm);
  }, [bpm]);

  useEffect(() => {
    const timers = flashTimers.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Remembered for next time — not on every hit while recording, but once it stops.
  useEffect(() => {
    if (recording) return;
    try {
      localStorage.setItem(STORAGE_KEY, serializeSettings({ kit, volume, bpm, click, quantize, countIn, length, loopBeats, takes }));
    } catch {
      // Private mode or full storage: it all still works, it just starts fresh next time.
    }
  }, [bpm, click, countIn, kit, length, loopBeats, quantize, recording, takes, volume]);

  /** Stops the clock when nothing needs it any more. */
  const settle = useCallback(() => {
    const current = engineRef.current;
    if (current && !current.metronome && !current.playing && !recRef.current) current.stop();
  }, []);

  const setMetronome = useCallback(
    (on: boolean) => {
      setClick(on);
      const current = on ? engine() : engineRef.current;
      if (!current) return;
      current.metronome = on;
      if (on && !current.running) {
        try {
          current.start(0.06);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "לא הצלחנו להפעיל את השמע.");
        }
      } else if (!on) settle();
    },
    [engine, settle],
  );

  /* ---- recording ---- */

  const recordHit = (drum: DrumId, velocity: number, zone: Zone, time: number) => {
    const rec = recRef.current;
    const current = engineRef.current;
    if (!rec || !current) return;
    const { snapped, beat } = placeHit(current.beatAt(time), rec.base, rec.free ? null : current.loopBeats, quantizeRef.current);
    const event: LoopEvent = { drum, beat, velocity, zone, notBefore: Math.max(time, current.timeAt(snapped)) + 0.004 };
    commitTakes(takesRef.current.map((take) => (take.id === rec.takeId ? { ...take, events: [...take.events, event] } : take)));
  };

  /** Plays a drum now, flashes it, and writes it into the take being recorded. */
  const strike = (drum: DrumId, velocity: number, zone: Zone, point?: { x: number; y: number }) => {
    let time: number;
    try {
      time = engine().hit(drum, velocity, zone);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "לא הצלחנו להפעיל את השמע.");
      return;
    }
    flash(drum, velocity, point);
    recordHit(drum, velocity, zone, time);
  };
  const strikeRef = useRef(strike);
  useEffect(() => {
    strikeRef.current = strike;
  });

  const startRecording = () => {
    if (recRef.current) return;
    const current = engine();
    try {
      current.ensure();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "לא הצלחנו להפעיל את השמע.");
      return;
    }
    setError(null);
    const hasLoop = Boolean(takesRef.current.length && loopBeatsRef.current);
    const free = !hasLoop && length === "free";
    if (!hasLoop && !free) commitLoopBeats((length as number) * BEATS_PER_BAR);
    let base = 0;
    if (!current.running) {
      current.loopStart = 0;
      current.start(countIn ? BEATS_PER_BAR * secondsPerBeat(bpm) : 0.08);
    } else if (free) {
      const now = current.currentBeat() ?? 0;
      base = quantize ? Math.round(now) : now;
    } else if (!(current.playing && hasLoop)) {
      // Line the loop up with the bars the metronome is already counting.
      current.loopStart = Math.max(Math.ceil(current.horizon / BEATS_PER_BAR - 0.5) * BEATS_PER_BAR, 0);
    }
    if (!free) base = current.loopStart;
    const takeId = newId();
    recRef.current = { takeId, base, free };
    commitTakes([...takesRef.current, { id: takeId, events: [] }]);
    current.playing = true;
    setPlaying(true);
    setRecording(true);
  };

  const stopRecording = () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    setRecording(false);
    const current = engineRef.current;
    const take = takesRef.current.find((item) => item.id === rec.takeId);
    if (!take || !take.events.length) {
      const rest = takesRef.current.filter((item) => item.id !== rec.takeId);
      commitTakes(rest);
      if (!rest.length) {
        commitLoopBeats(null);
        if (current) current.playing = false;
        setPlaying(false);
      }
      settle();
      return;
    }
    if (rec.free && current) {
      // The first free take sets the loop's length: from where it started to now.
      const beats = freeLoopBeats((current.currentBeat() ?? 0) - rec.base, quantizeRef.current);
      const events = take.events.map((event) => ({ ...event, beat: wrapBeat(event.beat, beats) }));
      current.loopStart = rec.base;
      commitLoopBeats(beats);
      commitTakes(takesRef.current.map((item) => (item.id === take.id ? { ...item, events } : item)));
    }
  };

  const toggleRecording = () => {
    if (recRef.current) stopRecording();
    else startRecording();
  };

  const playLoop = (): string | null => {
    if (!takesRef.current.length || !loopBeatsRef.current) return "עוד אין לולאה — לחצו „הקלטה” ונגנו משהו.";
    const current = engine();
    try {
      current.ensure();
    } catch (caught) {
      return caught instanceof Error ? caught.message : "לא הצלחנו להפעיל את השמע.";
    }
    if (!current.running) {
      current.loopStart = 0;
      current.start(0.08);
    } else if (!current.playing) {
      current.loopStart = Math.ceil(current.horizon / BEATS_PER_BAR) * BEATS_PER_BAR;
    }
    current.playing = true;
    setPlaying(true);
    setError(null);
    return null;
  };

  const stopLoop = () => {
    stopRecording();
    const current = engineRef.current;
    if (current) current.playing = false;
    setPlaying(false);
    settle();
  };

  const undoTake = () => {
    if (recRef.current) {
      recRef.current = null;
      setRecording(false);
    }
    const rest = takesRef.current.slice(0, -1);
    commitTakes(rest);
    if (!rest.length) {
      commitLoopBeats(null);
      stopLoop();
    }
  };

  const clearLoop = () => {
    recRef.current = null;
    setRecording(false);
    commitTakes([]);
    commitLoopBeats(null);
    stopLoop();
  };

  const chooseLength = (next: LoopLength) => {
    setLength(next);
    // A loop already recorded takes the new number of bars; a free choice keeps its own length.
    if (next !== "free" && takesRef.current.length && !recRef.current) commitLoopBeats(next * BEATS_PER_BAR);
  };

  /* ---- playing ---- */

  // The keyboard, by physical key, so a Hebrew layout plays the same drums.
  useEffect(() => {
    const isTyping = (target: HTMLElement | null) =>
      Boolean(target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable || target.closest("[role='dialog']")));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (isTyping(target)) return;
      // A pad that has the focus plays itself on Enter or Space.
      const focusedPad = target?.closest<HTMLElement>("[data-drum]")?.dataset.drum;
      const drum = focusedPad && (event.code === "Space" || event.key === "Enter") && isDrumId(focusedPad) ? focusedPad : drumForCode(event.code);
      if (!drum) return;
      event.preventDefault();
      if (event.repeat) return;
      strikeRef.current(drum, event.shiftKey ? 1 : 0.82, "normal");
    };
    // Space on a focused button would press it on the way up; here it is the kick.
    const onKeyUp = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code === "Space" && target?.tagName === "BUTTON" && !isTyping(target)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const midi = useMidiInput({
    onNoteOn: (note, velocity) => {
      const { drum, zone } = drumForMidiNote(note);
      strikeRef.current(drum, Math.max(0.1, velocity), zone);
    },
  });

  const onPadDown = (drum: DrumInfo) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // No focus ring, no text selection, no second (emulated) mouse event.
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const { velocity, zone } = velocityFromPosition(x * 2 - 1, y * 2 - 1, drum.shape);
    strike(drum.id, velocity, zone, { x, y });
  };

  // The loop's playhead, the beat lights and the count-in, straight from the audio clock.
  const running = playing || recording || click;
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let lastText = "";
    let lastBeat = -99;
    const tick = () => {
      const current = engineRef.current;
      const beat = current?.currentBeat() ?? null;
      if (current && beat !== null) {
        const loop = current.loopBeats;
        const rec = recRef.current;
        let fraction = 0;
        if (loop && current.playing && beat >= current.loopStart) fraction = wrapBeat(beat - current.loopStart, loop) / loop;
        else if (rec?.free && beat >= rec.base) fraction = ((beat - rec.base) % 16) / 16;
        if (progressRef.current) progressRef.current.style.transform = `scaleX(${fraction})`;
        let text: string;
        if (beat < 0) text = `ספירה… ${Math.ceil(-beat)}`;
        else if (rec?.free && !loop) text = `מקליט לולאה חופשית · ${Math.floor(beat - rec.base) + 1} פעמות`;
        else if (loop && current.playing && beat >= current.loopStart) {
          const position = wrapBeat(beat - current.loopStart, loop);
          text = `תיבה ${Math.floor(position / BEATS_PER_BAR) + 1} מתוך ${Math.ceil(loop / BEATS_PER_BAR)} · פעמה ${Math.floor(position % BEATS_PER_BAR) + 1}`;
        } else text = `פעמה ${((Math.floor(beat) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR + 1}`;
        if (text !== lastText && statusRef.current) {
          statusRef.current.textContent = text;
          lastText = text;
        }
        const whole = Math.floor(beat);
        if (whole !== lastBeat && lightsRef.current) {
          lastBeat = whole;
          const index = ((whole % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
          Array.from(lightsRef.current.children).forEach((light, lightIndex) => light.classList.toggle("is-on", lightIndex === index));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const lights = lightsRef.current;
    const progress = progressRef.current;
    const status = statusRef.current;
    return () => {
      cancelAnimationFrame(frame);
      if (progress) progress.style.transform = "scaleX(0)";
      if (status) status.textContent = "";
      if (lights) Array.from(lights.children).forEach((light) => light.classList.remove("is-on"));
    };
  }, [running]);

  /* ---- export ---- */

  const exportLoop = async (target: "download" | "mixer"): Promise<{ file: File } | { error: string }> => {
    if (busy) return { error: "ייצוא אחר כבר רץ." };
    const events = takesRef.current.flatMap((take) => take.events);
    const beats = loopBeatsRef.current;
    if (!events.length || !beats) {
      const message = "עוד אין לולאה לייצא — הקליטו קודם כמה מכות.";
      setError(message);
      return { error: message };
    }
    setBusy(target);
    setError(null);
    try {
      const buffer = await renderDrumLoop({ events, loopBeats: beats, bpm, kit, volume: Math.max(volume, 0.05), repeats });
      const blob = encodeWav(fromAudioBuffer(buffer));
      const file = new File([blob], `drumkit-${kit}-${bpm}bpm.wav`, { type: "audio/wav" });
      if (target === "download") downloadFile(file, file.name, file.type);
      else {
        stopLoop();
        await handOffTo("mixer", file, "הלולאה מהתופים האלקטרוניים");
      }
      return { file };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "הייצוא נכשל.";
      setError(message);
      return { error: message };
    } finally {
      setBusy(null);
    }
  };

  /* ---- the assistant ---- */

  const hitCount = countEvents(takes);
  const kitLabel = KITS.find((item) => item.id === kit)?.label ?? kit;

  useAssistantTool("drumkit", {
    state: () =>
      `תופים אלקטרוניים: ערכה ${kitLabel}; עוצמה ${Math.round(volume * 100)}%; ${bpm} BPM; מטרונום ${click ? "פועל" : "כבוי"}; יישור לרשת ${quantize ? "פועל" : "כבוי"}. ` +
      (loopBeats && takes.length
        ? `לולאה של ${describeLength(loopBeats)}, ${takes.length} טייקים, ${hitCount} מכות; ${recording ? "מקליט" : playing ? "מתנגנת" : "עצורה"}.`
        : recording
          ? "מקליט את הטייק הראשון."
          : "עוד לא הוקלטה לולאה."),
    handlers: {
      "drumkit.hit": ({ drum }) => {
        if (!isDrumId(drum)) return { ok: false, message: `אין תוף בשם ${String(drum)}` };
        strikeRef.current(drum, 0.9, "normal");
        return { ok: true, message: `${DRUMS.find((item) => item.id === drum)?.label}!` };
      },
      "drumkit.record": ({ command }) => {
        if (command === "start") {
          if (recRef.current) return { ok: true, message: "כבר מקליט" };
          startRecording();
          return { ok: true, message: countIn && !engineRef.current?.running ? "מקליט אחרי ספירה של תיבה" : "מקליט" };
        }
        if (command === "stop") {
          if (!recRef.current) return { ok: false, message: "לא הייתה הקלטה" };
          stopRecording();
          return { ok: true, message: "ההקלטה נעצרה; הלולאה ממשיכה להתנגן" };
        }
        return { ok: false, message: "הפקודה היא start או stop" };
      },
      "drumkit.loop": ({ command }) => {
        if (command === "play") {
          const problem = playLoop();
          return problem ? { ok: false, message: problem } : { ok: true, message: "הלולאה מתנגנת" };
        }
        if (command === "stop") {
          stopLoop();
          return { ok: true, message: "הלולאה נעצרה" };
        }
        return { ok: false, message: "הפקודה היא play או stop" };
      },
      "drumkit.set": ({ kit: nextKit, volume: nextVolume, bpm: nextBpm, click: nextClick }) => {
        const changes: string[] = [];
        if (nextKit !== undefined) {
          if (!isKitId(nextKit)) return { ok: false, message: `אין ערכה בשם ${String(nextKit)}` };
          setKit(nextKit);
          changes.push(`ערכה ${KITS.find((item) => item.id === nextKit)?.label}`);
        }
        if (nextVolume !== undefined) {
          const value = clamp(Number(nextVolume), 0, 100, volume * 100);
          setVolume(value / 100);
          changes.push(`עוצמה ${Math.round(value)}%`);
        }
        if (nextBpm !== undefined) {
          const value = Math.round(clamp(Number(nextBpm), MIN_BPM, MAX_BPM, bpm));
          setBpm(value);
          changes.push(`${value} BPM`);
        }
        if (nextClick !== undefined) {
          const on = nextClick === true || nextClick === "true";
          setMetronome(on);
          changes.push(on ? "מטרונום פועל" : "מטרונום כבוי");
        }
        return changes.length ? { ok: true, message: changes.join(" · ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "drumkit.export": async () => {
        const outcome = await exportLoop("download");
        return "file" in outcome ? { ok: true, message: `${outcome.file.name} ירד` } : { ok: false, message: outcome.error };
      },
    },
  });

  /* ---- the page ---- */

  const lane = useMemo(() => {
    if (!loopBeats) return [];
    return takes.flatMap((take) =>
      take.events.map((event) => ({
        x: (event.beat / loopBeats) * 1000,
        row: DRUMS.findIndex((drum) => drum.id === event.drum),
        velocity: event.velocity,
      })),
    );
  }, [loopBeats, takes]);

  const loopBars = loopBeats ? Math.ceil(loopBeats / BEATS_PER_BAR) : 0;
  const hasLoop = Boolean(loopBeats && takes.length);

  return (
    <section className="tool-body drumkit-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Drum size={26} />
        </span>
        <div>
          <h1>תופים אלקטרוניים</h1>
          <p>
            מנגנים באצבעות, בעכבר או במקלדת — כמה אצבעות יחד. מכה במרכז התוף חזקה יותר, בשוליים רכה יותר, ובמרכז המצילה נשמע הפעמון. אפשר
            להקליט לולאה ולנגן מעליה.
          </p>
        </div>
      </div>

      <div className="drumkit-deck">
        <div className="drumkit-transport">
          <button
            type="button"
            className={`drumkit-record ${recording ? "is-recording" : ""}`}
            onClick={toggleRecording}
            aria-pressed={recording}
          >
            {recording ? <Square size={16} fill="currentColor" /> : <Circle size={16} fill="currentColor" />}
            <span>{recording ? "עצירת הקלטה" : hasLoop ? "הקלטה מעל" : "הקלטה"}</span>
          </button>
          <button
            type="button"
            className={`drumkit-play ${playing ? "is-playing" : ""}`}
            onClick={() => {
              if (playing) stopLoop();
              else {
                const problem = playLoop();
                if (problem) setError(problem);
              }
            }}
            disabled={!playing && !hasLoop}
            aria-pressed={playing}
          >
            {playing ? <Square size={16} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            <span>{playing ? "עצירה" : "ניגון הלולאה"}</span>
          </button>
          <div className="drumkit-tempo">
            <button type="button" className={`drumkit-click ${click ? "is-on" : ""}`} onClick={() => setMetronome(!click)} aria-pressed={click} title="מטרונום">
              <Timer size={16} />
              <span className="drumkit-lights" ref={lightsRef} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
            </button>
            <div className="drumkit-bpm" dir="ltr">
              <button type="button" onClick={() => setBpm((value) => Math.max(MIN_BPM, value - 1))} aria-label="הורדת הקצב">
                <Minus size={15} />
              </button>
              <span>
                <b>{bpm}</b>
                <small>BPM</small>
              </span>
              <button type="button" onClick={() => setBpm((value) => Math.min(MAX_BPM, value + 1))} aria-label="העלאת הקצב">
                <Plus size={15} />
              </button>
            </div>
          </div>
          <div className="drumkit-edit">
            <button type="button" className="secondary-button compact" onClick={undoTake} disabled={!takes.length} title="ביטול הטייק האחרון">
              <Undo2 size={16} />
              <span>ביטול טייק</span>
            </button>
            <button type="button" className="secondary-button compact" onClick={clearLoop} disabled={!takes.length && !recording} title="מחיקת הלולאה">
              <Trash2 size={16} />
              <span>ניקוי</span>
            </button>
          </div>
        </div>

        <div className={`drumkit-loopbar ${recording ? "is-recording" : ""}`}>
          <div className="drumkit-loopline">
            <div className="drumkit-progress" ref={progressRef} />
            {loopBars > 1 &&
              Array.from({ length: loopBars - 1 }, (_, index) => (
                <i key={index} className="drumkit-barline" style={{ insetInlineStart: `${(((index + 1) * BEATS_PER_BAR) / (loopBeats ?? 1)) * 100}%` }} />
              ))}
            {lane.length > 0 && (
              <svg className="drumkit-lane" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
                {lane.map((dot, index) => (
                  <rect key={index} x={dot.x - 3} y={dot.row * 10 + 1} width={6} height={8} rx={2} opacity={0.35 + 0.65 * dot.velocity} />
                ))}
              </svg>
            )}
          </div>
          <p className="drumkit-status" aria-live="polite">
            <span ref={statusRef} />
            <em>
              {hasLoop
                ? `לולאה של ${describeLength(loopBeats!)} · ${takes.length} ${takes.length === 1 ? "טייק" : "טייקים"} · ${hitCount} מכות`
                : recording
                  ? "מנגנים — כל מכה נכנסת ללולאה"
                  : "מנגנים חופשי. „הקלטה” מתחילה לולאה."}
            </em>
          </p>
        </div>

        <div className="segmented-control drumkit-kits" role="group" aria-label="ערכת צליל">
          {KITS.map((item) => (
            <button key={item.id} type="button" className={kit === item.id ? "active" : ""} onClick={() => setKit(item.id)} aria-pressed={kit === item.id}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="drumkit-stage" data-kit={kit}>
        <div className="drumkit-board" dir="ltr" role="group" aria-label="מערכת התופים" onContextMenu={(event) => event.preventDefault()}>
          {DRUMS.map((drum) => (
            <button
              key={drum.id}
              type="button"
              data-drum={drum.id}
              className={`drumkit-pad is-${drum.shape} drumkit-${drum.id}`}
              style={{ "--x": drum.x, "--y": drum.y, "--d": drum.size } as CSSProperties}
              ref={(element) => {
                if (element) padRefs.current.set(drum.id, element);
                else padRefs.current.delete(drum.id);
              }}
              onPointerDown={onPadDown(drum)}
              aria-label={`${drum.label}, מקש ${KEY_MAP[drum.id].map((key) => key.label).join(" או ")}`}
            >
              <span className="drumkit-face" aria-hidden="true" />
              <span className="drumkit-glow" aria-hidden="true" />
              <span className="drumkit-label" aria-hidden="true">
                <b>{drum.label}</b>
                <kbd>{KEY_MAP[drum.id][0].label}</kbd>
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <div className="settings-panel">
        <div className="settings-title">
          <Volume2 size={18} /> צליל ולולאה <em>נשמר במכשיר הזה</em>
        </div>
        <div className="settings-grid">
          <label className="setting-field">
            <span>
              עוצמה <b>{Math.round(volume * 100)}%</b>
            </span>
            <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(event) => setVolume(Number(event.target.value) / 100)} aria-label="עוצמה ראשית" />
          </label>
          <label className="setting-field">
            <span>
              קצב <b>{bpm} BPM</b>
            </span>
            <input type="range" min={MIN_BPM} max={MAX_BPM} value={bpm} onChange={(event) => setBpm(Number(event.target.value))} aria-label="קצב" />
          </label>
          <div className="setting-field drumkit-length">
            <span>אורך הלולאה</span>
            <div className="segmented-control wrap" role="group" aria-label="אורך הלולאה">
              {(["free", ...LOOP_BARS] as LoopLength[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={length === option ? "active" : ""}
                  onClick={() => chooseLength(option)}
                  aria-pressed={length === option}
                  disabled={recording}
                >
                  {option === "free" ? "חופשי" : option === 1 ? "תיבה" : `${option} תיבות`}
                </button>
              ))}
            </div>
            <small>{length === "free" ? "הטייק הראשון קובע את האורך: מההתחלה ועד שעוצרים." : "הלולאה חוזרת אחרי מספר התיבות שנבחר."}</small>
          </div>
          <div className="drumkit-checks">
            <label className="checkbox-field">
              <input type="checkbox" checked={click} onChange={(event) => setMetronome(event.target.checked)} />
              מטרונום בקצב
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={quantize} onChange={(event) => setQuantize(event.target.checked)} />
              יישור ההקלטה לשש־עשריות
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={countIn} onChange={(event) => setCountIn(event.target.checked)} />
              ספירה של תיבה לפני הקלטה
            </label>
          </div>
        </div>
        {midi.supported && (
          <div className="drumkit-midi">
            <MidiButton midi={midi} />
            <small>פד תופים או מערכת אלקטרונית ב־MIDI מנגנים לפי מפת התופים הסטנדרטית (General MIDI).</small>
          </div>
        )}
      </div>

      <div className="downloads-card">
        <div>
          <span className="download-icon">
            <Download size={22} />
          </span>
          <div>
            <h3>הלולאה כקובץ</h3>
            <p>{hasLoop ? `${describeLength(loopBeats!)} · ${bpm} BPM · ערכה ${kitLabel}` : "הקליטו לולאה כדי להוריד אותה או לשלוח למיקסר."}</p>
          </div>
        </div>
        <div className="setting-field drumkit-repeats">
          <span>חזרות בקובץ</span>
          <div className="segmented-control" role="group" aria-label="חזרות בקובץ">
            {[1, 2, 4].map((count) => (
              <button key={count} type="button" className={repeats === count ? "active" : ""} onClick={() => setRepeats(count)} aria-pressed={repeats === count}>
                {count === 1 ? "פעם אחת" : `×${count}`}
              </button>
            ))}
          </div>
        </div>
        <div className="download-buttons">
          <button type="button" onClick={() => void exportLoop("download")} disabled={Boolean(busy) || !hasLoop}>
            {busy === "download" ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}
            <span>
              הורדת WAV<small>לולאה שחוזרת בדיוק על הקצב</small>
            </span>
          </button>
          <button type="button" onClick={() => void exportLoop("mixer")} disabled={Boolean(busy) || !hasLoop}>
            {busy === "mixer" ? <LoaderCircle size={17} className="spin" /> : <Layers size={17} />}
            <span>
              למיקסר<small>ערוץ תופים לצד השירה</small>
            </span>
          </button>
        </div>
      </div>

      <div className="settings-panel drumkit-keys">
        <div className="settings-title">
          <Keyboard size={18} /> מקשי המקלדת <em>Shift — מכה חזקה</em>
        </div>
        <ul>
          {DRUMS.map((drum) => (
            <li key={drum.id}>
              <span>{drum.label}</span>
              <span className="drumkit-keycaps" dir="ltr">
                {KEY_MAP[drum.id].map((key) => (
                  <kbd key={key.code}>{key.label}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
