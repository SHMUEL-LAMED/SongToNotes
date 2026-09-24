import { BookOpen, Check, Copy, Download, Guitar, Music3, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { ExplainSong } from "../components/ExplainSong";
import { ChordDiagram } from "../components/ChordDiagram";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import { formatTime } from "../lib/audio";
import {
  chordHebrew,
  chordName,
  chordSheet,
  transposeRoot,
  uniqueChords,
  type ChordQuality,
  type ChordSegment,
} from "../lib/audioChords";
import { downloadFile, safeFilename } from "../lib/export";
import { setSongbookDraft } from "../lib/songbook";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";
import type { SavedWork } from "../lib/works";
import type { ChordsRequest, ChordsResponse } from "../workers/chords.worker";

const QUALITIES: ChordQuality[] = ["", "m", "7", "m7", "maj7", "sus4", "sus2", "dim", "aug"];

function normalizeSegments(value: unknown): ChordSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ChordSegment | null => {
      if (!item || typeof item !== "object") return null;
      const { start, end, root, quality, confidence } = item as Record<string, unknown>;
      if (typeof start !== "number" || typeof end !== "number" || typeof root !== "number") return null;
      if (typeof quality !== "string" || !QUALITIES.includes(quality as ChordQuality)) return null;
      return {
        start,
        end,
        root: ((Math.round(root) % 12) + 12) % 12,
        quality: quality as ChordQuality,
        confidence: typeof confidence === "number" ? confidence : 0,
      };
    })
    .filter((item): item is ChordSegment => item !== null && item.end > item.start);
}

type Props = {
  initial?: SavedWork | null;
};

type Result = { segments: ChordSegment[]; duration: number; sourceName: string | null; elapsed: number | null };

function readInitial(work: SavedWork | null | undefined): { result: Result; transpose: number; capo: number } | null {
  if (!work || work.kind !== "chords") return null;
  const segments = normalizeSegments(work.payload.segments);
  if (!segments.length) return null;
  return {
    result: {
      segments,
      duration: typeof work.summary.duration === "number" ? work.summary.duration : segments[segments.length - 1].end,
      sourceName: work.sourceName,
      elapsed: null,
    },
    transpose: typeof work.payload.transpose === "number" ? work.payload.transpose : 0,
    capo: typeof work.payload.capo === "number" ? work.payload.capo : 0,
  };
}

/**
 * Chords for guitar, from a song. The engine ({@link ../lib/audioChords})
 * runs on a worker and hands back a timeline; this page follows it during
 * playback, shows how to finger each chord, and lets the visitor move the
 * whole song to a friendlier key or put a capo on.
 */
export function ChordsTool({ initial = null }: Props) {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [restored] = useState(() => readInitial(initial));
  const [result, setResult] = useState<Result | null>(restored?.result ?? null);
  const [transpose, setTranspose] = useState(restored?.transpose ?? 0);
  const [capo, setCapo] = useState(restored?.capo ?? 0);
  const [flats, setFlats] = useState(false);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(0);
  const [seek, setSeek] = useState<{ time: number; key: number; play?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(initial ? "פתחת אקורדים שמורים. השיר עצמו לא נשמר." : null);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const saving = useSaveWork();
  const resetSave = saving.reset;

  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => resetSave(), [resetSave, result, transpose, capo]);

  const analyse = useCallback(
    (buffer: AudioBuffer, sourceName: string) => {
      jobRef.current += 1;
      const jobId = jobRef.current;
      setBusy(true);
      setError(null);
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL("../workers/chords.worker.ts", import.meta.url), { type: "module" });
      }
      const worker = workerRef.current;
      worker.onmessage = (event: MessageEvent<ChordsResponse>) => {
        if (event.data.jobId !== jobRef.current) return;
        setBusy(false);
        if (event.data.type === "error") {
          setError(event.data.message);
          return;
        }
        if (!event.data.segments.length) {
          setError("לא זוהו אקורדים. נסה קטע עם ליווי ברור יותר.");
          return;
        }
        setResult({ segments: event.data.segments, duration: buffer.duration, sourceName, elapsed: event.data.elapsed });
      };
      worker.onerror = () => {
        setBusy(false);
        setError("זיהוי האקורדים נכשל.");
      };
      // A mono copy, handed over so the page keeps its own buffer.
      const mono = new Float32Array(buffer.length);
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = 0; index < mono.length; index += 1) mono[index] += data[index] / buffer.numberOfChannels;
      }
      const request: ChordsRequest = { jobId, mono, sampleRate: buffer.sampleRate };
      worker.postMessage(request, [mono.buffer]);
    },
    [setError],
  );

  useEffect(() => {
    if (!audio) return;
    // Deferred a tick, so the picker's own state settles before the worker starts.
    const timer = window.setTimeout(() => analyse(audio.buffer, audio.file.name), 0);
    return () => window.clearTimeout(timer);
  }, [analyse, audio]);

  // What is played versus what is fingered: the song moves by `transpose`,
  // and a capo lets the fingers stay in open shapes below it.
  const shift = transpose - capo;
  const shown = useMemo(
    () => (result ? result.segments.map((segment) => ({ ...segment, root: transposeRoot(segment.root, shift) })) : []),
    [result, shift],
  );
  const unique = useMemo(() => uniqueChords(shown), [shown]);
  const currentIndex = shown.findIndex((segment) => time >= segment.start && time < segment.end);
  const current = currentIndex >= 0 ? shown[currentIndex] : null;
  const title = result?.sourceName ? result.sourceName.replace(/\.[^/.]+$/, "") : audio ? audio.file.name.replace(/\.[^/.]+$/, "") : "אקורדים";
  const sheet = result ? chordSheet(result.segments, shift, flats) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sheet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("לא הצלחנו להעתיק. אפשר לסמן את הטקסט ולהעתיק ידנית.");
    }
  };

  const buildFile = () =>
    result ? new File([`\uFEFF${title}\n\n${sheet}`], `${safeFilename(title)}-chords.txt`, { type: "text/plain;charset=utf-8" }) : null;

  const save = () => {
    if (!result) return Promise.resolve(null);
    return saving.save({
      kind: "chords",
      title,
      sourceName: result.sourceName,
      summary: {
        chordCount: result.segments.length,
        unique: unique.map((item) => chordName(item.root, item.quality, flats)).slice(0, 8).join(" "),
        duration: result.duration,
        transpose,
        capo,
      },
      payload: { segments: result.segments, transpose, capo },
    });
  };

  const toSongbook = () => {
    // The chords, one per line, as a starting point for the lyrics.
    setSongbookDraft({ title, body: shown.map((segment) => `[${chordName(segment.root, segment.quality, flats)}]`).join(" ") });
    window.location.assign("#/songbook");
  };

  useAssistantTool("chords", {
    state: () =>
      `מזהה אקורדים: ${audio ? `השיר „${audio.file.name}”` : result?.sourceName ? `אקורדים שמורים של „${title}” בלי קובץ השמע` : "לא נבחר שיר (רק הגולש בוחר קובץ)"}; ${
        busy
          ? "מאזין לאקורדים עכשיו"
          : result
            ? `${unique.length} אקורדים שונים, ${result.segments.length} מעברים: ${unique.map((item) => chordName(item.root, item.quality, flats)).join(" ")}; טרנספוזיציה ${transpose}, קאפו ${capo || "בלי"}${current ? `; מנגן עכשיו ${chordName(current.root, current.quality, flats)}` : ""}`
            : "אין תוצאה עדיין"
      }.`,
    handlers: {
      "chords.read": () => {
        if (!result) return { ok: false, message: "אין אקורדים; הגולש צריך לבחור שיר" };
        return {
          ok: true,
          message: `${unique.length} אקורדים שונים`,
          data: {
            unique: unique.map((item) => chordName(item.root, item.quality, flats)),
            transpose,
            capo,
            timeline: shown.slice(0, 300).map((segment) => ({ chord: chordName(segment.root, segment.quality, flats), start: Number(segment.start.toFixed(1)), end: Number(segment.end.toFixed(1)) })),
            sheet: sheet.slice(0, 3000),
          },
        };
      },
      "chords.set": ({ transpose: shift, capo: fret, flats: useFlats }) => {
        if (!result) return { ok: false, message: "אין אקורדים עדיין" };
        const done: string[] = [];
        if (typeof shift === "number") {
          const clamped = Math.max(-6, Math.min(6, Math.round(shift)));
          setTranspose(clamped);
          done.push(`טרנספוזיציה ${clamped > 0 ? "+" : ""}${clamped}`);
        }
        if (typeof fret === "number") {
          const clamped = Math.max(0, Math.min(7, Math.round(fret)));
          setCapo(clamped);
          done.push(clamped ? `קאפו בשריג ${clamped}` : "בלי קאפו");
        }
        if (typeof useFlats === "boolean") {
          setFlats(useFlats);
          done.push(useFlats ? "שמות עם במול" : "שמות עם דיאז");
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "chords.toSongbook": () => {
        if (!result) return { ok: false, message: "אין אקורדים לשלוח" };
        toSongbook();
        return { ok: true, message: "האקורדים נשלחו לשירון; שם אפשר להוסיף מילים" };
      },
      "chords.download": () => {
        const file = buildFile();
        if (!file) return { ok: false, message: "אין אקורדים" };
        downloadFile(file, file.name, file.type);
        return { ok: true, message: `${file.name} ירד` };
      },
      "chords.save": async () => {
        if (!result) return { ok: false, message: "אין אקורדים לשמור" };
        const saved = await save();
        return saved ? { ok: true, message: "האקורדים נשמרו באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
    },
  });

  return (
    <section className="tool-body chords-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Guitar size={26} />
        </span>
        <div>
          <h1>מזהה אקורדים לגיטרה</h1>
          <p>בחר שיר וקבל את האקורדים לאורך הזמן, עם דיאגרמות אחיזה.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          onPick={(file) => {
            setError(null);
            setNotice(null);
            setResult(null);
            setTime(0);
            void load(file);
          }}
          onClear={() => {
            jobRef.current += 1;
            setBusy(false);
            setResult(null);
            clear();
          }}
          allowRecording
          hint="שיר עם ליווי ברור נותן את התוצאה הטובה ביותר · גיטרה, פסנתר או להקה"
        />
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

        {busy && (
          <div className="processing-box" aria-live="polite">
            <div className="processing-top">
              <span>
                <Wand2 size={18} /> מאזין לאקורדים…
              </span>
            </div>
            <div className="progress-track indeterminate">
              <div />
            </div>
          </div>
        )}

        {result && (
          <>
            <div className="settings-panel">
              <div className="settings-grid">
                <label className="setting-field">
                  <span>
                    <Music3 size={15} /> טרנספוזיציה <b>{transpose > 0 ? `+${transpose}` : transpose}</b>
                  </span>
                  <input type="range" min={-6} max={6} step={1} value={transpose} onChange={(event) => setTranspose(Number(event.target.value))} aria-label="טרנספוזיציה בחצאי טונים" />
                  <small>מזיז את כל השיר לסולם נוח יותר לשירה.</small>
                </label>
                <label className="setting-field">
                  <span>
                    <Guitar size={15} /> קאפו <b>{capo ? `שריג ${capo}` : "בלי"}</b>
                  </span>
                  <input type="range" min={0} max={7} step={1} value={capo} onChange={(event) => setCapo(Number(event.target.value))} aria-label="מיקום הקאפו" />
                  <small>עם קאפו האחיזות הופכות פשוטות יותר; הצליל נשאר אותו דבר.</small>
                </label>
                <label className="checkbox-field">
                  <input type="checkbox" checked={flats} onChange={(event) => setFlats(event.target.checked)} />
                  <span>שמות עם במול (B♭ במקום A♯)</span>
                </label>
              </div>
            </div>

            {audio && (
              <Transport buffer={audio.buffer} label="נגן עם האקורדים" onTime={setTime} seek={seek} />
            )}

            <div className="chords-now" aria-live="polite">
              {current ? (
                <>
                  <ChordDiagram root={current.root} quality={current.quality} size={120} flats={flats} active />
                  <div>
                    <strong dir="ltr">{chordName(current.root, current.quality, flats)}</strong>
                    <span>{chordHebrew(current.root, current.quality)}</span>
                    {shown[currentIndex + 1] && (
                      <small dir="auto">
                        הבא: <b dir="ltr">{chordName(shown[currentIndex + 1].root, shown[currentIndex + 1].quality, flats)}</b>
                      </small>
                    )}
                  </div>
                </>
              ) : (
                <p>{audio ? "לחץ על נגן — האקורד הנוכחי יופיע כאן תוך כדי השמעה." : "האקורדים שנשמרו, בסדר השמעה:"}</p>
              )}
            </div>

            <div className="chords-timeline" role="list" aria-label="האקורדים לאורך השיר">
              {shown.map((segment, index) => (
                <button
                  key={`${segment.start}-${index}`}
                  type="button"
                  role="listitem"
                  className={`chords-block ${index === currentIndex ? "is-current" : ""}`}
                  style={{ flexGrow: Math.max(1, segment.end - segment.start), "--chord-hue": `${(segment.root * 30) % 360}` } as React.CSSProperties}
                  onClick={() => setSeek({ time: segment.start, key: Date.now(), play: true })}
                  title={`${formatTime(segment.start)} – ${formatTime(segment.end)}`}
                >
                  <span dir="ltr">{chordName(segment.root, segment.quality, flats)}</span>
                  <small>{formatTime(segment.start)}</small>
                </button>
              ))}
            </div>

            <div className="chords-diagrams" aria-label="אחיזות">
              {unique.map((chord) => (
                <ChordDiagram key={`${chord.root}${chord.quality}`} root={chord.root} quality={chord.quality} flats={flats} active={current?.root === chord.root && current?.quality === chord.quality} />
              ))}
            </div>
            <p className="table-footnote">
              {unique.length} אקורדים שונים · {result.segments.length} מעברים
              {result.elapsed !== null ? ` · זוהו ב־${(result.elapsed / 1000).toFixed(1)} שניות בדפדפן` : ""}
              {capo ? ` · האחיזות מוצגות עם קאפו בשריג ${capo}` : ""}
            </p>

            <div className="downloads-card">
              <div>
                <span className="download-icon">
                  <Download size={22} />
                </span>
                <div>
                  <h3>דף אקורדים</h3>
                  <p>האקורדים עם הזמנים, כטקסט.</p>
                </div>
              </div>
              <div className="download-buttons">
                <button type="button" onClick={() => { const file = buildFile(); if (file) downloadFile(file, file.name, file.type); }}>
                  <Download size={17} />
                  <span>
                    TXT<small>דף אקורדים</small>
                  </span>
                </button>
                <button type="button" onClick={() => void copy()}>
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                  <span>
                    {copied ? "הועתק" : "העתק"}
                    <small>ללוח</small>
                  </span>
                </button>
                <button type="button" onClick={toSongbook}>
                  <BookOpen size={17} />
                  <span>
                    לשירון<small>להוסיף מילים</small>
                  </span>
                </button>
                <ShareButton build={buildFile} title={`אקורדים — ${title}`} />
              </div>
              <SaveButton state={saving.state} onSave={() => void save()} label="שמור את האקורדים" message={saving.message} />
            </div>
          </>
        )}
      </div>

      {result && shown.length > 0 && (
        <ExplainSong
          songKey={`${title}|${result.segments.length}|${transpose}`}
          describe={() => {
            // Consecutive repeats collapse, so the model reads the harmony, not the timing.
            const names: string[] = [];
            // The chords as they sound, not the shapes fingered under a capo.
            for (const segment of result.segments) {
              const name = chordName(transposeRoot(segment.root, transpose), segment.quality, flats);
              if (names[names.length - 1] !== name) names.push(name);
            }
            return [
              `שם הקובץ: ${title}`,
              `אורך: ${Math.round(result.duration)} שניות`,
              transpose ? `הועבר ב־${transpose} חצאי טונים מהמקור` : "",
              `רצף האקורדים לאורך השיר (זוהה אוטומטית מההקלטה, ייתכנו טעויות): ${names.join(" ")}`,
            ]
              .filter(Boolean)
              .join("\n");
          }}
        />
      )}
    </section>
  );
}
