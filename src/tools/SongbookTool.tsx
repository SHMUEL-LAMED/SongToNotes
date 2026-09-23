import { BookOpen, ChevronDown, ChevronUp, Copy, Check, Download, FolderOpen, Minus, Pause, Play, Plus, Printer, Type, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChordDiagram } from "../components/ChordDiagram";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { useAuth } from "../lib/auth";
import { downloadFile, safeFilename } from "../lib/export";
import { foldChordLines, parseChordSymbol, parseSong, songChords, songToText, takeSongbookDraft, transposeSong } from "../lib/songbook";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";
import { listWorks, type SavedWork } from "../lib/works";

const EXAMPLE = `[פזמון]
[Am]היה היה [G]פעם ילד [C]קטן
[F]שאהב לשיר [E]בגן`;

type Props = {
  initial?: SavedWork | null;
};

function readInitial(work: SavedWork | null | undefined) {
  if (!work || work.kind !== "song") return null;
  const body = typeof work.payload.body === "string" ? work.payload.body : "";
  return { title: work.title, body, transpose: typeof work.payload.transpose === "number" ? work.payload.transpose : 0 };
}

/**
 * A songbook: lyrics with the chords above the words, the way a singer's
 * sheet looks. The text is typed with chords in brackets — [Am] before the
 * word it falls on — or pasted as chords over lyrics and folded. The sheet
 * can be moved to another key, scrolled by itself on stage, printed, and
 * kept in the personal area.
 */
export function SongbookTool({ initial = null }: Props) {
  const { user } = useAuth();
  const [restored] = useState<{ title: string; body: string; transpose: number } | null>(() => {
    const opened = readInitial(initial);
    if (opened) return opened;
    const draft = takeSongbookDraft();
    return draft ? { ...draft, transpose: 0 } : null;
  });
  const [title, setTitle] = useState(restored?.title ?? "");
  const [body, setBody] = useState(restored?.body ?? "");
  const [transpose, setTranspose] = useState(restored?.transpose ?? 0);
  const [flats, setFlats] = useState(false);
  const [fontSize, setFontSize] = useState(18);
  const [editing, setEditing] = useState(!restored?.body);
  const [scrolling, setScrolling] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(30);
  const [showDiagrams, setShowDiagrams] = useState(true);
  const [copied, setCopied] = useState(false);
  const [songs, setSongs] = useState<SavedWork[] | null>(null);
  const [showSongs, setShowSongs] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const saving = useSaveWork();
  const resetSave = saving.reset;

  useEffect(() => resetSave(), [resetSave, body, title, transpose]);

  // The visible text carries the transposition; the stored one is the original.
  const shown = useMemo(() => transposeSong(body, transpose, flats), [body, flats, transpose]);
  const lines = useMemo(() => parseSong(shown), [shown]);
  const chords = useMemo(() => songChords(shown), [shown]);

  // Autoscroll for the stage: a slow, steady crawl the singer sets the pace of.
  useEffect(() => {
    if (!scrolling) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const sheet = sheetRef.current;
      if (sheet) {
        sheet.scrollTop += ((now - last) / 1000) * scrollSpeed;
        if (sheet.scrollTop + sheet.clientHeight >= sheet.scrollHeight - 1) setScrolling(false);
      }
      last = now;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [scrollSpeed, scrolling]);

  const loadSongs = async () => {
    setShowSongs((value) => !value);
    if (songs) return;
    const all = await listWorks(user?.id ?? null).catch(() => []);
    setSongs(all.filter((item) => item.kind === "song"));
  };

  const openSong = (song: SavedWork) => {
    const read = readInitial(song);
    if (!read) return;
    setTitle(read.title);
    setBody(read.body);
    setTranspose(read.transpose);
    setEditing(false);
    setShowSongs(false);
  };

  const plain = songToText(shown);
  const buildFile = () => (body.trim() ? new File([`\uFEFF${title || "שיר"}\n\n${plain}`], `${safeFilename(title || "שיר")}.txt`, { type: "text/plain;charset=utf-8" }) : null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The text is on screen; it can be selected by hand.
    }
  };

  const save = () => {
    if (!body.trim()) return Promise.resolve(null);
    return saving.save({
      kind: "song",
      title: title.trim() || lines.find((line) => line.kind === "line" && line.lyric.trim())?.lyric.slice(0, 40) || "שיר",
      summary: { lines: lines.filter((line) => line.kind === "line").length, chords: chords.slice(0, 6).join(" "), transpose },
      payload: { body, transpose },
    });
  };

  const lineCount = (text: string) => parseSong(text).filter((line) => line.kind === "line" && line.lyric.trim()).length;
  useAssistantTool("songbook", {
    state: () =>
      body.trim()
        ? `שירון: „${title || "ללא כותרת"}”, ${lines.filter((line) => line.kind === "line").length} שורות, אקורדים: ${chords.join(" ") || "אין"}, טרנספוזיציה ${transpose}, מצב ${editing ? "עריכה" : "תצוגה"}${scrolling ? ", גלילה אוטומטית פועלת" : ""}. תחילת הטקסט: ${body.slice(0, 160).replace(/\n/g, " / ")}`
        : "שירון: ריק.",
    handlers: {
      "songbook.write": ({ title: nextTitle, body: nextBody }) => {
        const text = String(nextBody);
        setBody(text);
        if (typeof nextTitle === "string") setTitle(nextTitle.slice(0, 120));
        setEditing(false);
        return { ok: true, message: `נכתבו ${lineCount(text)} שורות${typeof nextTitle === "string" ? ` בשם „${nextTitle.slice(0, 60)}”` : ""}` };
      },
      "songbook.append": ({ body: more }) => {
        const extra = String(more);
        setBody((current) => (current.trim() ? `${current.replace(/\s+$/, "")}\n\n${extra}` : extra));
        setEditing(false);
        return { ok: true, message: `נוספו ${lineCount(extra)} שורות` };
      },
      "songbook.read": () => ({ ok: true, message: body.trim() ? "" : "השירון ריק", data: { title, body, transpose, chords } }),
      "songbook.set": ({ transpose: shift, fontSize: size, flats: useFlats, diagrams, view }) => {
        const done: string[] = [];
        if (typeof shift === "number") {
          setTranspose(Math.max(-11, Math.min(11, Math.round(shift))));
          done.push(`טרנספוזיציה ${Math.round(shift)}`);
        }
        if (typeof size === "number") {
          setFontSize(Math.max(14, Math.min(32, Math.round(size))));
          done.push(`גודל טקסט ${Math.round(size)}`);
        }
        if (typeof useFlats === "boolean") {
          setFlats(useFlats);
          done.push(useFlats ? "שמות עם במול" : "שמות עם דיאז");
        }
        if (typeof diagrams === "boolean") {
          setShowDiagrams(diagrams);
          done.push(diagrams ? "אחיזות מוצגות" : "אחיזות מוסתרות");
        }
        if (view === "edit" || view === "view") {
          if (view === "view" && !body.trim()) return { ok: false, message: "אין טקסט להציג" };
          setEditing(view === "edit");
          done.push(view === "edit" ? "מצב עריכה" : "מצב תצוגה");
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "songbook.scroll": ({ on, speed }) => {
        if (!body.trim()) return { ok: false, message: "אין טקסט לגלול" };
        if (typeof speed === "number") setScrollSpeed(Math.max(5, Math.min(120, Math.round(speed))));
        setEditing(false);
        setScrolling(Boolean(on));
        return { ok: true, message: on ? "הגלילה האוטומטית פועלת" : "הגלילה נעצרה" };
      },
      "songbook.save": async () => {
        if (!body.trim()) return { ok: false, message: "השירון ריק" };
        const saved = await save();
        return saved ? { ok: true, message: "השיר נשמר באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
      "songbook.download": () => {
        const file = buildFile();
        if (!file) return { ok: false, message: "השירון ריק" };
        downloadFile(file, file.name, file.type);
        return { ok: true, message: `${file.name} ירד` };
      },
      "songbook.print": () => {
        if (!body.trim()) return { ok: false, message: "השירון ריק" };
        setEditing(false);
        window.setTimeout(() => window.print(), 150);
        return { ok: true, message: "חלון ההדפסה נפתח" };
      },
    },
  });

  return (
    <section className="tool-body songbook-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <BookOpen size={26} />
        </span>
        <div>
          <h1>שירון</h1>
          <p>מילים עם אקורדים מעליהן, לתרגול ולהופעה.</p>
        </div>
      </div>

      <div className="workspace-card">
        <div className="songbook-toolbar">
          <input className="songbook-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="שם השיר" aria-label="שם השיר" dir="auto" />
          <div className="segmented-control" role="group" aria-label="תצוגה">
            <button type="button" className={editing ? "active" : ""} aria-pressed={editing} onClick={() => setEditing(true)}>
              עריכה
            </button>
            <button type="button" className={!editing ? "active" : ""} aria-pressed={!editing} onClick={() => setEditing(false)} disabled={!body.trim()}>
              תצוגה
            </button>
          </div>
          <button type="button" className="link-button" onClick={() => void loadSongs()}>
            <FolderOpen size={15} /> השירים שלי {showSongs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {showSongs && (
          <div className="songbook-list" role="list">
            {songs === null && <p className="table-footnote">טוען…</p>}
            {songs && songs.length === 0 && <p className="table-footnote">עדיין אין שירים שמורים. כתוב שיר ולחץ "שמור".</p>}
            {songs?.map((song) => (
              <button key={song.id} type="button" role="listitem" className="chip-toggle" onClick={() => openSong(song)}>
                {song.title}
              </button>
            ))}
          </div>
        )}

        {editing ? (
          <>
            <textarea
              className="songbook-editor"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={`כתוב את המילים, ואת האקורד בסוגריים מרובעים לפני המילה שבה הוא מתחלף:\n${EXAMPLE}`}
              rows={14}
              aria-label="מילים ואקורדים"
              dir="auto"
              spellCheck={false}
            />
            <div className="songbook-editor-tools">
              <button type="button" className="link-button" onClick={() => setBody((current) => foldChordLines(current))}>
                <Wand2 size={14} /> הדבקתי אקורדים מעל המילים — סדר לסוגריים
              </button>
              {!body.trim() && (
                <button type="button" className="link-button" onClick={() => { setBody(EXAMPLE); setTitle("דוגמה"); }}>
                  טען דוגמה
                </button>
              )}
            </div>
            <p className="table-footnote">
              כותרת של קטע כותבים בסוגריים לבד בשורה: [פזמון]. אפשר להדביק דף אקורדים מהאינטרנט כמו שהוא וללחוץ "סדר לסוגריים".
            </p>
          </>
        ) : (
          <>
            <div className="settings-panel songbook-controls">
              <div className="settings-grid">
                <div className="setting-field">
                  <span>
                    טרנספוזיציה <b>{transpose > 0 ? `+${transpose}` : transpose}</b>
                  </span>
                  <div className="songbook-stepper">
                    <button type="button" onClick={() => setTranspose((value) => Math.max(-11, value - 1))} aria-label="חצי טון למטה">
                      <Minus size={16} />
                    </button>
                    <button type="button" onClick={() => setTranspose(0)} className="link-button">
                      אפס
                    </button>
                    <button type="button" onClick={() => setTranspose((value) => Math.min(11, value + 1))} aria-label="חצי טון למעלה">
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <div className="setting-field">
                  <span>
                    <Type size={15} /> גודל טקסט <b>{fontSize}</b>
                  </span>
                  <input type="range" min={14} max={32} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} aria-label="גודל הטקסט" />
                </div>
                <div className="setting-field">
                  <span>גלילה אוטומטית</span>
                  <div className="songbook-stepper">
                    <button type="button" className="primary-button compact" onClick={() => setScrolling((value) => !value)} aria-pressed={scrolling}>
                      {scrolling ? <Pause size={16} /> : <Play size={16} />} {scrolling ? "עצור" : "התחל"}
                    </button>
                    <input type="range" min={5} max={120} value={scrollSpeed} onChange={(event) => setScrollSpeed(Number(event.target.value))} aria-label="מהירות הגלילה" />
                  </div>
                </div>
                <label className="checkbox-field">
                  <input type="checkbox" checked={flats} onChange={(event) => setFlats(event.target.checked)} />
                  <span>שמות עם במול</span>
                </label>
                <label className="checkbox-field">
                  <input type="checkbox" checked={showDiagrams} onChange={(event) => setShowDiagrams(event.target.checked)} />
                  <span>הצג אחיזות</span>
                </label>
              </div>
            </div>

            {showDiagrams && chords.length > 0 && (
              <div className="chords-diagrams songbook-diagrams">
                {chords.map((name) => {
                  const parsed = parseChordSymbol(name);
                  return parsed ? <ChordDiagram key={name} root={parsed.root} quality={parsed.quality} size={72} flats={flats} /> : null;
                })}
              </div>
            )}

            <div className="songbook-sheet" ref={sheetRef} style={{ fontSize }} dir="auto">
              {title && <h2>{title}</h2>}
              {lines.map((line, index) => {
                if (line.kind === "blank") return <div key={index} className="songbook-blank" />;
                if (line.kind === "heading") return <h3 key={index}>{line.lyric}</h3>;
                if (!line.chords.length) return <p key={index}>{line.lyric}</p>;
                // Each chord opens a span that carries the chord above the word it starts on.
                const pieces: { chord: string | null; text: string }[] = [];
                let cursor = 0;
                line.chords.forEach((chord, at) => {
                  if (chord.at > cursor) pieces.push({ chord: at === 0 ? null : null, text: line.lyric.slice(cursor, chord.at) });
                  const end = line.chords[at + 1]?.at ?? line.lyric.length;
                  pieces.push({ chord: chord.name, text: line.lyric.slice(chord.at, end) || " " });
                  cursor = end;
                });
                if (cursor < line.lyric.length) pieces.push({ chord: null, text: line.lyric.slice(cursor) });
                return (
                  <p key={index} className="songbook-line">
                    {pieces.map((piece, at) => (
                      // A chord over nothing but spaces — a bar of an intro, a
                      // chords-only line — still needs room of its own.
                      <span key={at} className={`songbook-piece ${piece.chord && !piece.text.trim() ? "is-bare" : ""}`}>
                        <span className="songbook-chord" dir="ltr">{piece.chord ?? " "}</span>
                        <span className="songbook-word">{piece.text}</span>
                      </span>
                    ))}
                  </p>
                );
              })}
            </div>
          </>
        )}

        <div className="downloads-card">
          <div>
            <span className="download-icon">
              <Download size={22} />
            </span>
            <div>
              <h3>הדף</h3>
              <p>להדפסה, להעתקה או לשמירה באזור האישי.</p>
            </div>
          </div>
          <div className="download-buttons">
            <button type="button" onClick={() => window.print()} disabled={!body.trim()}>
              <Printer size={17} />
              <span>
                הדפס<small>או שמור כ־PDF</small>
              </span>
            </button>
            <button type="button" onClick={() => { const file = buildFile(); if (file) downloadFile(file, file.name, file.type); }} disabled={!body.trim()}>
              <Download size={17} />
              <span>
                TXT<small>אקורדים מעל המילים</small>
              </span>
            </button>
            <button type="button" onClick={() => void copy()} disabled={!body.trim()}>
              {copied ? <Check size={17} /> : <Copy size={17} />}
              <span>
                {copied ? "הועתק" : "העתק"}
                <small>ללוח</small>
              </span>
            </button>
            <ShareButton build={buildFile} title={title || "שיר"} />
          </div>
          <SaveButton state={saving.state} onSave={() => void save()} disabled={!body.trim()} label="שמור בשירון" message={saving.message} />
        </div>
      </div>
    </section>
  );
}
