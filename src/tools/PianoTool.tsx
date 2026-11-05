import { Circle, Download, GraduationCap, Piano, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MidiButton } from "../components/MidiButton";
import { PianoLesson } from "../components/PianoLesson";
import { useMidiInput } from "../lib/midiInput";
import { SaveButton } from "../components/SaveButton";
import { midiToFrequency } from "../lib/dsp";
import { downloadFile, notesToMidi } from "../lib/export";
import { plainNoteName, scientificName } from "../lib/key";
import { parseNoteName } from "../lib/noteNames";
import { clearPianoLesson, fitKeyboard, readPianoLesson } from "../lib/pianoLesson";
import type { DetectedNote } from "../lib/types";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";

type Timbre = "piano" | "organ" | "synth";

const KEYBOARD_ROW = "awsedftgyhujkolp;'";
/**
 * The same row by physical key. `event.key` is "ש" for A while the Hebrew
 * layout is on — the usual layout for this site's visitors — so matching
 * characters left the computer keyboard silent; codes do not change with it.
 */
const KEYBOARD_CODES = [
  "KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY",
  "KeyH", "KeyU", "KeyJ", "KeyK", "KeyO", "KeyL", "KeyP", "Semicolon", "Quote",
];
/** The highest octave the keys may start at, so the top key stays a MIDI note (≤ 127). */
const maxOctave = (octaves: number) => 9 - octaves;
const ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const SCALES: { id: string; label: string; steps: number[] }[] = [
  { id: "none", label: "ללא", steps: [] },
  { id: "major", label: "מז׳ור", steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", label: "מינור", steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: "harmonic", label: "מינור הרמוני", steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: "pent-major", label: "פנטטוני מז׳ור", steps: [0, 2, 4, 7, 9] },
  { id: "pent-minor", label: "פנטטוני מינור", steps: [0, 3, 5, 7, 10] },
  { id: "blues", label: "בלוז", steps: [0, 3, 5, 6, 7, 10] },
  { id: "dorian", label: "דוריאני", steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: "mixolydian", label: "מיקסולידי", steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: "freygish", label: "פריגי דומיננטי", steps: [0, 1, 4, 5, 7, 8, 10] },
];

const BLACK = new Set([1, 3, 6, 8, 10]);

type Voice = { osc: OscillatorNode[]; gain: GainNode; release: () => void };

/** The span of a recording, from its first attack to its last release. */
function recordingSeconds(notes: DetectedNote[]) {
  return notes.reduce((end, note) => Math.max(end, note.start + note.duration), 0);
}

/**
 * A playable keyboard with its own small synth. Held keys are tracked by
 * MIDI number so the mouse, touch and the computer keyboard can all hold
 * notes at once, and the recorder simply timestamps those transitions.
 */
export function PianoTool() {
  // A song sent from song-to-notes to learn, on the keys that hold it.
  const [lesson, setLesson] = useState(() => {
    const saved = readPianoLesson();
    if (!saved) return null;
    const fit = fitKeyboard(saved.notes);
    return { title: saved.title, notes: fit.notes, octave: fit.octave, octaves: fit.octaves };
  });
  const [octave, setOctave] = useState(() => lesson?.octave ?? 3);
  const [octaveCount, setOctaveCount] = useState(() =>
    lesson?.octaves ?? (window.innerWidth < 720 ? 2 : 3),
  );
  // While a lesson is open its notes fall onto these keys, so they stay put.
  const locked = lesson !== null;
  const [guide, setGuide] = useState<number[]>([]);
  const [timbre, setTimbre] = useState<Timbre>("piano");
  const [sustain, setSustain] = useState(false);
  const [showNames, setShowNames] = useState(true);
  const [scaleRoot, setScaleRoot] = useState(0);
  const [scaleId, setScaleId] = useState("none");
  const [held, setHeld] = useState<Set<number>>(() => new Set());
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<DetectedNote[]>([]);
  const [volume, setVolume] = useState(0.7);
  const saving = useSaveWork();
  const resetSave = saving.reset;

  const contextRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const voicesRef = useRef<Map<number, Voice>>(new Map());
  const timbreRef = useRef(timbre);
  const sustainRef = useRef(sustain);
  const recordingRef = useRef<{ startedAt: number; open: Map<number, number> } | null>(null);
  // Which note each pointer (mouse, or each finger) is holding, so one
  // finger sliding off a key releases its own note, not another finger's.
  const pointerNotesRef = useRef<Map<number, number>>(new Map());
  // Which note each computer key started: releasing the key releases that
  // note even if the octave moved (Z / X) while it was held.
  const keyNotesRef = useRef<Map<string, number>>(new Map());
  // Whether the sustain came from holding Space, so losing focus lifts it.
  const spaceSustainRef = useRef(false);
  // The keys that are physically down right now (as against notes still
  // ringing on the pedal), kept in step with every note on and off.
  const downRef = useRef<Set<number>>(new Set());
  const keysRef = useRef<HTMLDivElement>(null);
  const lessonPressRef = useRef<((midi: number) => void) | null>(null);

  useEffect(() => {
    timbreRef.current = timbre;
    sustainRef.current = sustain;
    if (masterRef.current) masterRef.current.gain.value = volume;
  }, [sustain, timbre, volume]);

  const ensureContext = useCallback(() => {
    if (!contextRef.current) {
      const Context =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Context) return null;
      contextRef.current = new Context();
      masterRef.current = contextRef.current.createGain();
      masterRef.current.gain.value = volume;
      // A soft limiter keeps chords from clipping when many keys are down.
      const compressor = contextRef.current.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.ratio.value = 6;
      masterRef.current.connect(compressor);
      compressor.connect(contextRef.current.destination);
    }
    if (contextRef.current.state === "suspended") void contextRef.current.resume();
    return contextRef.current;
  }, [volume]);

  useEffect(() => () => void contextRef.current?.close(), []);

  const noteOn = useCallback(
    (midi: number) => {
      const context = ensureContext();
      const master = masterRef.current;
      if (!context || !master || downRef.current.has(midi)) return;
      // A note still ringing on the sustain pedal is struck again, as on a
      // piano; before, the key did nothing at all until the pedal came up.
      const ringing = voicesRef.current.get(midi);
      if (ringing) {
        ringing.release();
        voicesRef.current.delete(midi);
      }
      downRef.current.add(midi);
      const now = context.currentTime;
      const frequency = midiToFrequency(midi);
      const gain = context.createGain();
      gain.connect(master);
      const oscillators: OscillatorNode[] = [];
      const kind = timbreRef.current;

      if (kind === "piano") {
        const body = context.createOscillator();
        body.type = "triangle";
        body.frequency.value = frequency;
        const bright = context.createOscillator();
        bright.type = "sine";
        bright.frequency.value = frequency * 2;
        const brightGain = context.createGain();
        brightGain.gain.value = 0.3;
        bright.connect(brightGain);
        brightGain.connect(gain);
        body.connect(gain);
        oscillators.push(body, bright);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.02, now + 4);
      } else if (kind === "organ") {
        [1, 2, 3, 4].forEach((harmonic, index) => {
          const osc = context.createOscillator();
          osc.type = "sine";
          osc.frequency.value = frequency * harmonic;
          const partial = context.createGain();
          partial.gain.value = [0.5, 0.3, 0.15, 0.1][index];
          osc.connect(partial);
          partial.connect(gain);
          oscillators.push(osc);
        });
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.4, now + 0.03);
      } else {
        const saw = context.createOscillator();
        saw.type = "sawtooth";
        saw.frequency.value = frequency;
        const detuned = context.createOscillator();
        detuned.type = "sawtooth";
        detuned.frequency.value = frequency;
        detuned.detune.value = 8;
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(Math.min(12000, frequency * 8), now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(300, frequency * 2), now + 0.6);
        filter.Q.value = 4;
        saw.connect(filter);
        detuned.connect(filter);
        filter.connect(gain);
        oscillators.push(saw, detuned);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
      }

      oscillators.forEach((osc) => osc.start(now));
      const release = () => {
        const at = context.currentTime;
        gain.gain.cancelScheduledValues(at);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), at);
        const tail = kind === "piano" ? 0.25 : kind === "organ" ? 0.08 : 0.35;
        gain.gain.exponentialRampToValueAtTime(0.0001, at + tail);
        oscillators.forEach((osc) => osc.stop(at + tail + 0.05));
      };
      voicesRef.current.set(midi, { osc: oscillators, gain, release });
      setHeld((current) => new Set(current).add(midi));

      const session = recordingRef.current;
      if (session && !session.open.has(midi)) {
        session.open.set(midi, performance.now());
      }
    },
    [ensureContext],
  );

  const noteOff = useCallback((midi: number, force = false) => {
    downRef.current.delete(midi);
    setHeld((current) => {
      if (!current.has(midi)) return current;
      const next = new Set(current);
      next.delete(midi);
      return next;
    });
    const session = recordingRef.current;
    if (session) {
      const startedAt = session.open.get(midi);
      if (startedAt !== undefined) {
        session.open.delete(midi);
        const start = (startedAt - session.startedAt) / 1000;
        const duration = Math.max(0.05, (performance.now() - startedAt) / 1000);
        setRecorded((current) => [...current, { midi, start, duration, confidence: 0.9 }]);
      }
    }
    if (sustainRef.current && !force) return;
    const voice = voicesRef.current.get(midi);
    if (!voice) return;
    voice.release();
    voicesRef.current.delete(midi);
  }, []);

  // What the visitor plays, as against what the lesson or the assistant
  // plays: a lesson being practised hears it.
  const playerNoteOn = useCallback(
    (midi: number) => {
      noteOn(midi);
      lessonPressRef.current?.(midi);
    },
    [noteOn],
  );
  const releaseLessonNote = useCallback((midi: number) => noteOff(midi, true), [noteOff]);
  const closeLesson = useCallback(() => {
    clearPianoLesson();
    setLesson(null);
    setGuide([]);
  }, []);

  // A keyboard plugged into the computer plays the same voices, across its
  // whole range rather than only the octaves on screen.
  const midi = useMidiInput({
    onNoteOn: (note) => playerNoteOn(note),
    onNoteOff: (note) => noteOff(note),
    onSustain: setSustain,
  });

  // Turning sustain off releases whatever the pedal was still holding.
  useEffect(() => {
    if (sustain) return;
    voicesRef.current.forEach((voice, midi) => {
      if (!held.has(midi)) {
        voice.release();
        voicesRef.current.delete(midi);
      }
    });
  }, [held, sustain]);

  // Three octaves from the top octave would run past MIDI 127 (C10), which
  // also made a corrupt MIDI file of a recording up there.
  const shownOctave = Math.min(octave, maxOctave(octaveCount));
  const lowest = (shownOctave + 1) * 12;
  const keys = useMemo(() => {
    const list: { midi: number; black: boolean; whiteIndex: number }[] = [];
    let whiteIndex = 0;
    for (let midi = lowest; midi <= lowest + octaveCount * 12; midi += 1) {
      const black = BLACK.has(midi % 12);
      list.push({ midi, black, whiteIndex: black ? whiteIndex - 1 : whiteIndex });
      if (!black) whiteIndex += 1;
    }
    return list;
  }, [lowest, octaveCount]);
  const whiteCount = keys.filter((key) => !key.black).length;

  const scale = useMemo(() => SCALES.find((item) => item.id === scaleId) ?? SCALES[0], [scaleId]);
  const inScale = useCallback(
    (midi: number) => scale.steps.length > 0 && scale.steps.includes((((midi - scaleRoot) % 12) + 12) % 12),
    [scale.steps, scaleRoot],
  );

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      // Ctrl+F, Ctrl+S, Cmd+D… belong to the browser, not to the keys.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      const code = event.code;
      if (code === "KeyZ" || code === "KeyX") {
        if (!event.repeat && !locked) {
          setOctave((value) =>
            code === "KeyZ"
              ? Math.max(0, Math.min(maxOctave(octaveCount), value) - 1)
              : Math.min(maxOctave(octaveCount), value + 1),
          );
        }
        return;
      }
      if (code === "Space") {
        // Repeats too, or holding the pedal scrolls the page.
        event.preventDefault();
        if (event.repeat) return;
        spaceSustainRef.current = true;
        setSustain(true);
        return;
      }
      const index = KEYBOARD_CODES.indexOf(code);
      if (index < 0) return;
      event.preventDefault();
      if (event.repeat || keyNotesRef.current.has(code)) return;
      const midi = lowest + index;
      keyNotesRef.current.set(code, midi);
      playerNoteOn(midi);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        if (spaceSustainRef.current) {
          spaceSustainRef.current = false;
          setSustain(false);
        }
        return;
      }
      const midi = keyNotesRef.current.get(event.code);
      if (midi === undefined) return;
      keyNotesRef.current.delete(event.code);
      noteOff(midi);
    };
    // Switching window or tab swallows the key-up and pointer-up that would
    // have ended a note; without this it rings (and records) forever.
    const releaseAll = () => {
      keyNotesRef.current.forEach((midi) => noteOff(midi));
      keyNotesRef.current.clear();
      pointerNotesRef.current.forEach((midi) => noteOff(midi));
      pointerNotesRef.current.clear();
      if (spaceSustainRef.current) {
        spaceSustainRef.current = false;
        setSustain(false);
      }
    };
    const onVisibility = () => {
      if (document.hidden) releaseAll();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [locked, lowest, noteOff, octaveCount, playerNoteOn]);

  // A new take is a new recording, whatever the last one's button says.
  useEffect(() => {
    if (recording) resetSave();
  }, [recording, resetSave]);

  const saveRecording = () => {
    if (!recorded.length) return Promise.resolve(null);
    return saving.save({
      kind: "piano",
      title: `הקלטת פסנתר · ${recorded.length} תווים`,
      summary: {
        noteCount: recorded.length,
        duration: recordingSeconds(recorded),
        timbre,
      },
      payload: { notes: recorded, timbre, analysisOffset: 0 },
    });
  };

  const toggleRecording = () => {
    if (recording) {
      const session = recordingRef.current;
      const stillHeld: DetectedNote[] = [];
      session?.open.forEach((startedAt, midi) => {
        stillHeld.push({
          midi,
          start: (startedAt - session.startedAt) / 1000,
          duration: Math.max(0.05, (performance.now() - startedAt) / 1000),
          confidence: 0.9,
        });
      });
      // Notes are logged as they are released, so a held chord lands after
      // the quick notes played over it; the take is kept in playing order.
      setRecorded((current) => [...current, ...stillHeld].sort((a, b) => a.start - b.start || a.midi - b.midi));
      recordingRef.current = null;
      setRecording(false);
    } else {
      setRecorded([]);
      recordingRef.current = { startedAt: performance.now(), open: new Map() };
      setRecording(true);
    }
  };

  const downloadMidi = () => {
    const data = notesToMidi(recorded, {
      bpm: 120,
      quantized: false,
      offset: 0,
      stepsPerBeat: 4,
      transpose: 0,
    });
    downloadFile(data, "piano-recording.mid", "audio/midi");
  };

  useAssistantTool("piano", {
    state: () =>
      `פסנתר וירטואלי: מקשים C${shownOctave}–C${shownOctave + octaveCount}, צליל ${timbre}, הדגשת סולם ${scale.id === "none" ? "כבויה" : `${ROOT_NAMES[scaleRoot]} ${scale.label}`}, סוסטיין ${sustain ? "פועל" : "כבוי"}, עוצמה ${Math.round(volume * 100)}%${recording ? `; מקליט (${recorded.length} תווים עד כה)` : recorded.length ? `; יש הקלטה של ${recorded.length} תווים` : ""}${lesson ? `; פתוח לימוד של „${lesson.title || "שיר"}” (${lesson.notes.length} תווים; המקשים קבועים עד שהגולש סוגר אותו)` : ""}.`,
    handlers: {
      "piano.play": async ({ notes: names, mode: how, seconds }) => {
        const list = (names as string[]).slice(0, 32);
        const midis = list.map((name) => parseNoteName(name));
        const unknown = list.filter((_, index) => midis[index] === null);
        if (unknown.length) return { ok: false, message: `תווים לא מוכרים: ${unknown.join(", ")}. כתוב כמו C4, F#3, Bb2` };
        const valid = midis.filter((midi): midi is number => midi !== null);
        if (!valid.length) return { ok: false, message: "לא צוינו תווים" };
        const together = how === "chord";
        const hold = Math.max(0.2, Math.min(4, typeof seconds === "number" ? seconds : together ? 1.5 : 0.5));
        const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
        if (together) {
          valid.forEach((midi) => noteOn(midi));
          await wait(hold * 1000);
          valid.forEach((midi) => noteOff(midi, true));
        } else {
          for (const midi of valid) {
            noteOn(midi);
            await wait(hold * 1000);
            noteOff(midi, true);
            await wait(40);
          }
        }
        return { ok: true, message: `נוגנו ${valid.map((midi) => scientificName(midi)).join(" ")}${together ? " יחד" : ""}` };
      },
      "piano.set": ({ octave: nextOctave, timbre: nextTimbre, scale: nextScale, root, sustain: nextSustain, names: nextNames, volume: nextVolume, octaves }) => {
        const done: string[] = [];
        if (locked && (typeof nextOctave === "number" || typeof octaves === "number")) {
          return { ok: false, message: "בזמן לימוד שיר המקשים קבועים; כדי לשנות אוקטבה צריך לסגור את הלימוד" };
        }
        if (typeof nextOctave === "number") {
          const clamped = Math.max(0, Math.min(maxOctave(typeof octaves === "number" && octaves >= 3 ? 3 : octaveCount), Math.round(nextOctave)));
          setOctave(clamped);
          done.push(`אוקטבה ${clamped}`);
        }
        if (nextTimbre === "piano" || nextTimbre === "organ" || nextTimbre === "synth") {
          setTimbre(nextTimbre);
          done.push(`צליל ${nextTimbre}`);
        }
        if (typeof nextScale === "string") {
          const found = SCALES.find((item) => item.id === nextScale);
          if (!found) return { ok: false, message: `אין סולם כזה; יש: ${SCALES.map((item) => item.id).join(", ")}` };
          setScaleId(found.id);
          done.push(`סולם ${found.label}`);
        }
        if (typeof root === "string") {
          const index = ROOT_NAMES.indexOf(root);
          if (index < 0) return { ok: false, message: `שורש לא מוכר; יש: ${ROOT_NAMES.join(", ")}` };
          setScaleRoot(index);
          done.push(`שורש ${root}`);
        }
        if (typeof nextSustain === "boolean") {
          setSustain(nextSustain);
          done.push(nextSustain ? "סוסטיין פועל" : "סוסטיין כבוי");
        }
        if (typeof nextNames === "boolean") {
          setShowNames(nextNames);
          done.push(nextNames ? "שמות תווים מוצגים" : "שמות תווים מוסתרים");
        }
        if (typeof nextVolume === "number") {
          setVolume(Math.max(0, Math.min(1, nextVolume / 100)));
          done.push(`עוצמה ${Math.round(nextVolume)}%`);
        }
        if (typeof octaves === "number") {
          setOctaveCount(octaves >= 3 ? 3 : 2);
          done.push(`${octaves >= 3 ? 3 : 2} אוקטבות`);
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "piano.record": ({ on }) => {
        if (Boolean(on) === recording) return { ok: true, message: recording ? "כבר מקליט" : "לא הייתה הקלטה פעילה" };
        toggleRecording();
        return { ok: true, message: on ? "ההקלטה התחילה; כל נגינה נרשמת" : `ההקלטה נעצרה (${recorded.length} תווים)` };
      },
      "piano.downloadMidi": () => {
        if (!recorded.length) return { ok: false, message: "אין הקלטה" };
        downloadMidi();
        return { ok: true, message: "קובץ ה־MIDI ירד" };
      },
      "piano.save": async () => {
        if (!recorded.length) return { ok: false, message: "אין הקלטה לשמור" };
        const saved = await saveRecording();
        return saved ? { ok: true, message: "ההקלטה נשמרה באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
      "piano.read": () => ({
        ok: true,
        message: recorded.length ? `${recorded.length} תווים בהקלטה` : "אין הקלטה",
        data: { recording, count: recorded.length, notes: recorded.slice(0, 200).map((note) => ({ note: scientificName(note.midi), start: Number(note.start.toFixed(2)), duration: Number(note.duration.toFixed(2)) })), octave: shownOctave, timbre, scale: scale.id, root: ROOT_NAMES[scaleRoot] },
      }),
    },
  });

  /** A pointer lands on a key, or slides onto it from the one it held. */
  const pressPointer = (pointerId: number, midi: number) => {
    const notes = pointerNotesRef.current;
    const previous = notes.get(pointerId);
    if (previous === midi) return;
    notes.set(pointerId, midi);
    // Another finger may still be on the key this one slid off.
    if (previous !== undefined && ![...notes.values()].includes(previous)) noteOff(previous);
    playerNoteOn(midi);
  };
  const releasePointer = (pointerId: number) => {
    const notes = pointerNotesRef.current;
    const midi = notes.get(pointerId);
    if (midi === undefined) return;
    notes.delete(pointerId);
    if (![...notes.values()].includes(midi)) noteOff(midi);
  };

  const heldNames = Array.from(held)
    .sort((a, b) => a - b)
    .map((midi) => scientificName(midi));

  return (
    <section className="tool-body piano-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Piano size={26} />
        </span>
        <div>
          <h1>פסנתר וירטואלי</h1>
          <p>נגן בעכבר, במגע או במקלדת.</p>
        </div>
        {!recording && recorded.length > 0 && (
          <div className="tool-intro-side">
            <SaveButton state={saving.state} onSave={() => void saveRecording()} label="שמור את ההקלטה" message={saving.message} compact />
          </div>
        )}
      </div>

      <div className="piano-status" aria-live="polite">
        <span className="piano-held">{heldNames.length ? heldNames.join("  ") : "—"}</span>
        {recording && <span className="recording-chip"><span className="recording-dot small" /> מקליט · {recorded.length} תווים</span>}
      </div>

      <div className={`piano-stage ${lesson ? "has-lesson" : ""}`}>
        {lesson && (
          <PianoLesson
            title={lesson.title}
            notes={lesson.notes}
            keysRef={keysRef}
            layout={`${lowest}-${octaveCount}`}
            play={noteOn}
            release={releaseLessonNote}
            pressRef={lessonPressRef}
            onGuide={setGuide}
            onClose={closeLesson}
          />
        )}
        <div
          ref={keysRef}
          className="piano-keys"
          dir="ltr"
          style={{ "--white-count": whiteCount } as React.CSSProperties}
          onPointerLeave={(event) => releasePointer(event.pointerId)}
        >
          {keys.map((key) => {
            const active = held.has(key.midi);
            const highlighted = inScale(key.midi);
            const isRoot = scale.steps.length > 0 && ((key.midi - scaleRoot) % 12 + 12) % 12 === 0;
            const mappedKey = KEYBOARD_ROW[key.midi - lowest];
            return (
              <button
                key={key.midi}
                type="button"
                data-midi={key.midi}
                className={`piano-key ${key.black ? "black" : "white"} ${active ? "is-active" : ""} ${highlighted ? "in-scale" : ""} ${isRoot ? "is-root" : ""} ${guide.includes(key.midi) ? "is-guide" : ""}`}
                style={
                  key.black
                    ? { left: `calc((${key.whiteIndex} + 0.68) * (100% / ${whiteCount}))` }
                    : undefined
                }
                aria-label={plainNoteName(key.midi)}
                aria-pressed={active}
                onPointerDown={(event) => {
                  event.preventDefault();
                  // Touch captures the pointer to the first key; letting go
                  // of that lets a finger slide across the keys.
                  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  pressPointer(event.pointerId, key.midi);
                }}
                onPointerEnter={(event) => {
                  if (event.buttons !== 1) return;
                  pressPointer(event.pointerId, key.midi);
                }}
                onPointerUp={(event) => releasePointer(event.pointerId)}
                onPointerCancel={(event) => releasePointer(event.pointerId)}
              >
                {showNames && !key.black && (
                  <span className="piano-key-name">
                    {scientificName(key.midi)}
                    {mappedKey && <small>{mappedKey.toUpperCase()}</small>}
                  </span>
                )}
                {showNames && key.black && mappedKey && (
                  <span className="piano-key-name">
                    <small>{mappedKey.toUpperCase()}</small>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="piano-controls">
        <div className="segmented-control" role="group" aria-label="אוקטבה">
          <button type="button" disabled={locked || shownOctave <= 0} onClick={() => setOctave(Math.max(0, shownOctave - 1))}>
            אוקטבה −
          </button>
          <span className="segmented-label" dir="ltr">C{shownOctave}–C{shownOctave + octaveCount}</span>
          <button type="button" disabled={locked || shownOctave >= maxOctave(octaveCount)} onClick={() => setOctave(Math.min(maxOctave(octaveCount), shownOctave + 1))}>
            אוקטבה +
          </button>
        </div>
        <button
          className={`secondary-button ${sustain ? "is-on" : ""}`}
          type="button"
          onClick={() => setSustain((value) => !value)}
          aria-pressed={sustain}
        >
          פדל סוסטיין {sustain ? "פועל" : "כבוי"}
        </button>
        <MidiButton midi={midi} />
        <button
          className={`secondary-button ${recording ? "is-danger" : ""}`}
          type="button"
          onClick={toggleRecording}
          data-tour="piano-record"
        >
          {recording ? <Square size={16} /> : <Circle size={16} />}
          {recording ? "עצור הקלטה" : "הקלט נגינה"}
        </button>
        {!recording && recorded.length > 0 && (
          <button className="primary-button compact" type="button" onClick={downloadMidi}>
            <Download size={16} /> הורד MIDI ({recorded.length} תווים)
          </button>
        )}
      </div>

      {!lesson && (
        <p className="piano-lesson-tip">
          <GraduationCap size={16} aria-hidden="true" />
          <span>רוצים ללמוד שיר? זהו את התווים שלו ב„שיר לתווים” ולחצו „ללמוד בפסנתר”: התווים ייפלו על המקשים.</span>
          <a href="#/notes">לשיר לתווים</a>
        </p>
      )}

      <div className="settings-panel">
        <div className="settings-grid">
          <div className="setting-field">
            <span>צליל</span>
            <div className="segmented-control">
              {(["piano", "organ", "synth"] as Timbre[]).map((kind) => (
                <button
                  key={kind}
                  className={timbre === kind ? "active" : ""}
                  onClick={() => setTimbre(kind)}
                  type="button"
                  aria-pressed={timbre === kind}
                >
                  {kind === "piano" ? "פסנתר" : kind === "organ" ? "אורגן" : "סינת׳"}
                </button>
              ))}
            </div>
          </div>
          <label className="setting-field">
            <span>הדגשת סולם</span>
            <div className="tempo-row">
              <select value={scaleRoot} onChange={(event) => setScaleRoot(Number(event.target.value))} aria-label="טוניקה">
                {ROOT_NAMES.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
              <select value={scaleId} onChange={(event) => setScaleId(event.target.value)} aria-label="סוג סולם">
                {SCALES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <div className="setting-field">
            <span>תצוגה</span>
            <div className="segmented-control">
              <button className={octaveCount === 2 ? "active" : ""} disabled={locked} onClick={() => setOctaveCount(2)} type="button">
                2 אוקטבות
              </button>
              <button className={octaveCount === 3 ? "active" : ""} disabled={locked} onClick={() => setOctaveCount(3)} type="button">
                3 אוקטבות
              </button>
            </div>
          </div>
          <label className="setting-field range-field">
            <span>
              עוצמה <b>{Math.round(volume * 100)}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => setVolume(Number(event.target.value) / 100)}
            />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={showNames} onChange={(event) => setShowNames(event.target.checked)} />
            <span>הצג שמות תווים ומקשים</span>
          </label>
        </div>
      </div>
    </section>
  );
}
