import { Captions, Download, FileText, LogIn, Mic2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import { Waveform } from "../components/Waveform";
import { useAuth } from "../lib/auth";
import { buildPeaks, formatTime, type TrimRange } from "../lib/audio";
import { downloadFile, safeFilename } from "../lib/export";
import { applyLineEdits, buildLines, linesToLrc, linesToText, positionAt, type LyricLine } from "../lib/lyrics";
import { CANCELLED, transcribeWindow, type SpeechWord } from "../lib/speechApi";
import { LANGUAGES, languageLabel, segmentsToSrt, splitIntoWindows, type TranscriptSegment } from "../lib/transcript";
import { useSaveWork } from "../lib/useSaveWork";
import type { SavedWork } from "../lib/works";

const RATE = 16_000;
const WINDOW_SECONDS = 240;

function normalizeLines(value: unknown): LyricLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): LyricLine | null => {
      if (!item || typeof item !== "object") return null;
      const { start, end, text, words } = item as Record<string, unknown>;
      if (typeof start !== "number" || typeof text !== "string") return null;
      const list = Array.isArray(words)
        ? words
            .map((word) => (word && typeof word === "object" && typeof (word as { text: unknown }).text === "string" ? { text: String((word as { text: string }).text), start: Number((word as { start: unknown }).start) || 0, end: Number((word as { end: unknown }).end) || 0 } : null))
            .filter((word): word is { text: string; start: number; end: number } => word !== null)
        : [];
      return { start, end: typeof end === "number" ? end : start + 3, text, words: list.length ? list : [{ text, start, end: typeof end === "number" ? end : start + 3 }] };
    })
    .filter((item): item is LyricLine => item !== null && item.text.trim().length > 0);
}

type Props = { initial?: SavedWork | null };

function normalizeLanguage(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === "string" && LANGUAGES.some((item) => item.id === value) ? value : "he";
}

/**
 * Lyrics that follow the song: the recogniser hears the words with their
 * times, the page lights each word as it is sung, and the result goes out
 * as LRC (plain or word by word), SRT for a video, or the personal area.
 * Works on the singing straight from the mix; on a vocals-only track from
 * the separator it is cleaner still.
 */
export function LyricsTool({ initial = null }: Props) {
  // Decoded once, as mono at the recogniser's rate: a long song stays small
  // in memory, and the same samples are what go up to the server.
  const { audio, error, setError, isLoading, progress, load, clear } = useAudioFile({ maxBytes: 600 * 1024 * 1024, monoAt: RATE });
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const [language, setLanguage] = useState<string | null>(() => (initial && "language" in initial.payload ? normalizeLanguage(initial.payload.language) : "he"));
  const [lines, setLines] = useState<LyricLine[]>(() => normalizeLines(initial?.payload.lines));
  const [text, setText] = useState(() => linesToText(normalizeLines(initial?.payload.lines)));
  const [trim, setTrim] = useState<TrimRange>(null);
  const [stage, setStage] = useState<{ index: number; count: number; upload: number } | null>(null);
  const [time, setTime] = useState(0);
  const [seek, setSeek] = useState<{ time: number; key: number; play?: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(initial ? "פתחת מילים שמורות. השיר עצמו לא נשמר — בחר אותו שוב כדי לשיר איתו." : null);
  const abortRef = useRef<AbortController | null>(null);
  const tokenRef = useRef(0);
  const karaokeRef = useRef<HTMLDivElement>(null);
  const saving = useSaveWork();
  const resetSave = saving.reset;
  const peaks = useMemo(() => (audio ? buildPeaks(audio.buffer) : null), [audio]);

  useEffect(() => resetSave(), [resetSave, lines]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async () => {
    if (!audio || stage) return;
    tokenRef.current += 1;
    const token = tokenRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setNotice(null);
    setStage({ index: 0, count: 1, upload: 0 });
    try {
      const mono = audio.buffer.getChannelData(0);
      const from = trim ? Math.floor(trim.start * RATE) : 0;
      const to = trim ? Math.ceil(trim.end * RATE) : mono.length;
      const windows = splitIntoWindows(mono, RATE, WINDOW_SECONDS, 8, from, to);
      const segments: TranscriptSegment[] = [];
      const words: SpeechWord[] = [];
      for (let index = 0; index < windows.length; index += 1) {
        const window_ = windows[index];
        setStage({ index, count: windows.length, upload: 0 });
        const found = await transcribeWindow(mono.subarray(window_.start, window_.end), RATE, {
          language,
          words: true,
          signal: controller.signal,
          onUpload: (percent) => setStage({ index, count: windows.length, upload: percent }),
        });
        if (tokenRef.current !== token) return;
        const offset = window_.start / RATE;
        segments.push(...found.segments.map((segment) => ({ start: segment.start + offset, end: segment.end === null ? null : segment.end + offset, text: segment.text })));
        words.push(...(found.words ?? []).map((word) => ({ ...word, start: word.start + offset, end: word.end + offset })));
      }
      const built = buildLines(segments, words);
      setLines(built);
      setText(linesToText(built));
      if (!built.length) setError("לא זוהו מילים. נסה קטע עם שירה ברורה יותר, או הפרד קודם את השירה.");
    } catch (caught) {
      if (tokenRef.current !== token) return;
      const message = caught instanceof Error ? caught.message : "הזיהוי נכשל.";
      if (message !== CANCELLED) setError(message);
    } finally {
      if (tokenRef.current === token) {
        setStage(null);
        abortRef.current = null;
      }
    }
  }, [audio, language, setError, stage, trim]);

  const stop = () => {
    tokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStage(null);
  };

  /** The lines as they stand, with the textbox's unapplied edits included. */
  const currentLines = () => (editing ? applyLineEdits(lines, text) : lines);

  const commitEdits = () => {
    setLines((current) => applyLineEdits(current, text));
    setEditing(false);
  };

  const position = positionAt(lines, time);
  const currentLine = position.line;

  // The line being sung stays in view while the song plays.
  useEffect(() => {
    const box = karaokeRef.current;
    if (!box || currentLine < 0) return;
    const element = box.children[currentLine] as HTMLElement | undefined;
    if (!element) return;
    const top = element.offsetTop - box.offsetTop;
    const target = top - box.clientHeight / 2 + element.offsetHeight / 2;
    if (Math.abs(box.scrollTop - target) > 8) box.scrollTop = Math.max(0, target);
  }, [currentLine, editing]);
  const title = audio ? audio.file.name.replace(/\.[^/.]+$/, "") : initial?.title ?? "מילים";

  const buildFile = (format: "lrc" | "elrc" | "srt" | "txt") => {
    const rows = currentLines();
    if (!rows.length) return null;
    const body =
      format === "srt"
        ? segmentsToSrt(rows.map((line) => ({ start: line.start, end: line.end, text: line.text })))
        : format === "txt"
          ? linesToText(rows)
          : linesToLrc(rows, format === "elrc", { title });
    const ext = format === "elrc" ? "lrc" : format;
    return new File([`\uFEFF${body}`], `${safeFilename(title)}${format === "elrc" ? "-words" : ""}.${ext}`, { type: "text/plain;charset=utf-8" });
  };

  const save = () => {
    const rows = currentLines();
    if (!rows.length) return;
    if (editing) setLines(rows);
    void saving.save({
      kind: "lyrics",
      title,
      sourceName: audio?.file.name ?? initial?.sourceName ?? null,
      summary: { lines: rows.length, languageLabel: languageLabel(language), duration: audio?.buffer.duration ?? rows[rows.length - 1].end },
      payload: { lines: rows, language },
    });
  };

  const busy = stage !== null;

  return (
    <section className="tool-body lyrics-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Mic2 size={26} />
        </span>
        <div>
          <h1>מילים מסונכרנות</h1>
          <p>המילים של השיר עם הזמנים — קריוקי שנדלק מילה אחר מילה, וקובץ LRC.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          progress={progress}
          onPick={(file) => {
            setError(null);
            setNotice(null);
            setTrim(null);
            void load(file);
          }}
          onClear={() => {
            stop();
            setTrim(null);
            clear();
          }}
          allowRecording
          hint="שיר, או השירה לבד מכלי הסרת השירה — התוצאה נקייה יותר"
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

        {audio && (
          <>
            <div className="settings-panel">
              <div className="settings-grid">
                <label className="setting-field">
                  <span>שפת השירה</span>
                  <select value={language ?? ""} onChange={(event) => setLanguage(event.target.value || null)} aria-label="שפת השירה" disabled={busy}>
                    {LANGUAGES.map((item) => (
                      <option key={item.id ?? "auto"} value={item.id ?? ""}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {peaks && <Waveform peaks={peaks} duration={audio.buffer.duration} trim={trim} onTrimChange={setTrim} cursor={time} selectLabel="קטע לזיהוי" clearLabel="זהה את כל השיר" emptyLabel="אפשר לסמן קטע כדי לזהות רק אותו" />}
            {!user && !authLoading ? (
              <div className="transcript-signin" role="status">
                <p>
                  <LogIn size={16} /> זיהוי המילים נעשה בשרת — צריך להתחבר לחשבון, בחינם.
                </p>
                <button className="primary-button" type="button" onClick={() => signInWithGoogle().catch(() => setError("לא הצלחנו לפתוח את ההתחברות."))}>
                  <LogIn size={20} /> התחברות עם Google
                </button>
              </div>
            ) : !busy ? (
              <button className="primary-button" type="button" onClick={() => void run()} disabled={authLoading}>
                <Wand2 size={20} /> זהה את המילים והזמנים
                <small>{formatTime(trim ? trim.end - trim.start : audio.buffer.duration)}</small>
              </button>
            ) : (
              <div className="processing-box" aria-live="polite">
                <div className="processing-top">
                  <span>
                    <Wand2 size={18} /> {stage.upload < 100 ? "שולח לשרת…" : "השרת מאזין למילים…"}
                  </span>
                  <strong>{stage.count > 1 ? `חלק ${stage.index + 1} מתוך ${stage.count}` : `${stage.upload}%`}</strong>
                </div>
                <div className="progress-track indeterminate">
                  <div />
                </div>
                <button type="button" className="link-button" onClick={stop}>
                  <X size={14} /> בטל
                </button>
              </div>
            )}
          </>
        )}

        {lines.length > 0 && (
          <>
            {audio && <Transport buffer={audio.buffer} label="שיר עם המילים" onTime={setTime} seek={seek} />}
            <div className="lyrics-toolbar">
              <button type="button" className={`chip-toggle ${!editing ? "active" : ""}`} onClick={() => (editing ? commitEdits() : setEditing(false))}>
                <Captions size={14} /> קריוקי
              </button>
              <button type="button" className={`chip-toggle ${editing ? "active" : ""}`} onClick={() => setEditing(true)}>
                <FileText size={14} /> עריכת המילים
              </button>
              <span className="table-footnote">{lines.length} שורות · {lines.reduce((sum, line) => sum + line.words.length, 0)} מילים</span>
            </div>
            {editing ? (
              <>
                <textarea className="transcript-text" value={text} onChange={(event) => setText(event.target.value)} rows={Math.min(20, lines.length + 2)} aria-label="המילים, שורה לכל משפט" dir="auto" />
                <div className="songbook-editor-tools">
                  <button type="button" className="primary-button compact" onClick={commitEdits}>
                    החל את התיקונים
                  </button>
                  <small className="ai-status">שורה לכל משפט. הזמנים של השורות נשמרים; מילים שהשתנו מקבלות את הזמנים של קודמותיהן.</small>
                </div>
              </>
            ) : (
              <div className="lyrics-karaoke" dir="auto" aria-live="off" ref={karaokeRef}>
                {lines.map((line, lineIndex) => (
                  <p
                    key={`${line.start}-${lineIndex}`}
                    className={`lyrics-line ${lineIndex === position.line ? "is-current" : lineIndex < position.line ? "is-past" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`נגן מ־${formatTime(line.start)}: ${line.text}`}
                    onClick={() => setSeek({ time: line.start, key: Date.now(), play: true })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSeek({ time: line.start, key: Date.now(), play: true });
                      }
                    }}
                  >
                    <time>{formatTime(line.start)}</time>
                    {line.words.map((word, wordIndex) => (
                      <span key={wordIndex} className={`lyrics-word ${lineIndex === position.line && wordIndex <= position.word ? "is-sung" : ""} ${lineIndex === position.line && wordIndex === position.word ? "is-now" : ""}`}>
                        {word.text}
                      </span>
                    ))}
                  </p>
                ))}
              </div>
            )}

            <div className="downloads-card">
              <div>
                <span className="download-icon">
                  <Download size={22} />
                </span>
                <div>
                  <h3>הורדה</h3>
                  <p>LRC לנגנים ולאפליקציות קריוקי, SRT לסרטון, או טקסט.</p>
                </div>
              </div>
              <div className="download-buttons">
                {(
                  [
                    ["lrc", "LRC", "לפי שורות"],
                    ["elrc", "LRC מילים", "מילה אחר מילה"],
                    ["srt", "SRT", "כתוביות לסרטון"],
                    ["txt", "TXT", "המילים בלבד"],
                  ] as const
                ).map(([format, label, note]) => (
                  <button key={format} type="button" onClick={() => { const file = buildFile(format); if (file) downloadFile(file, file.name, file.type); }}>
                    {format === "srt" ? <Captions size={17} /> : <FileText size={17} />}
                    <span>
                      {label}
                      <small>{note}</small>
                    </span>
                  </button>
                ))}
                <ShareButton build={() => buildFile("lrc")} title={`מילים — ${title}`} />
              </div>
              <SaveButton state={saving.state} onSave={save} label="שמור את המילים" message={saving.message} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
