import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Copy,
  CopyPlus,
  FolderOpen,
  GripVertical,
  ListMusic,
  Maximize,
  MessageCircle,
  Minimize,
  Pause,
  Plus,
  Printer,
  RotateCcw,
  Timer,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../lib/auth";
import {
  DEFAULT_BREAK_SECONDS,
  breakCountLabel,
  clockAt,
  duplicateSetlist,
  entryFromSong,
  formatDuration,
  loadStore,
  makeBreak,
  makeSetlist,
  makeSong,
  moveEntry,
  normalizeBpm,
  normalizeStartTime,
  parseDuration,
  refreshLinkedSongs,
  runningStarts,
  saveStore,
  setTotals,
  setlistToText,
  songCountLabel,
  songNumbers,
  targetStatus,
  type SetEntry,
  type Setlist,
  type SetlistStore,
} from "../lib/setlist";
import { parseSong, setSongbookDraft, transposeSong } from "../lib/songbook";
import { findTool } from "../lib/tools";
import { useAssistantTool } from "../lib/useAssistantTool";
import { listWorks, type SavedWork } from "../lib/works";
import "./setlist.css";

type Props = {
  /**
   * Opens a saved work in its own tool, the way the personal area does. When
   * the shell does not pass it, a linked song is handed to the songbook as a
   * draft instead — same text, but saving there makes a new copy.
   */
  onOpenWork?: (work: SavedWork) => void;
};

// The stage is portalled to <body> (a transformed ancestor would otherwise
// trap `position: fixed`), so it takes the tool's hue explicitly.
const HUE = findTool("setlist")?.hue ?? 210;

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

/**
 * A setlist for the gig: several named lists, each an ordered run of songs
 * and breaks with key, tempo, length and notes; the total against the slot;
 * a printable page and a text for the band's group chat; and a stage mode
 * that fills the phone or tablet with the song being played now.
 */
export function SetlistTool({ onOpenWork }: Props) {
  const { user } = useAuth();
  const [store, setStore] = useState<SetlistStore>(() => loadStore());
  // One test write on arrival tells whether this browser keeps anything
  // (private modes, blocked site data); later writes are then assumed to work.
  const [storageFailed] = useState(() => !saveStore(store));
  const [songs, setSongs] = useState<SavedWork[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [stageOpen, setStageOpen] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // `pending` is set after a swap until React has re-rendered the rows, so a
  // burst of pointer events measured against the old layout cannot swap twice.
  const dragRef = useRef<{ id: string; pointerId: number; pending: boolean } | null>(null);

  const active = store.setlists.find((item) => item.id === store.activeId) ?? store.setlists[0];
  const entries = active.entries;
  const totals = useMemo(() => setTotals(entries), [entries]);
  const starts = useMemo(() => runningStarts(entries), [entries]);
  const numbers = useMemo(() => songNumbers(entries), [entries]);
  const target = targetStatus(totals.total, active.targetMinutes);
  // A stage left open over a list that was emptied (the assistant removing
  // the last song) would otherwise spring back up at the next song added.
  if (stageOpen && !entries.length) setStageOpen(false);

  // Every change is written straight away: a setlist is edited in the
  // rehearsal room and opened again at the venue, often with no signal.
  useEffect(() => {
    saveStore(store);
  }, [store]);

  const updateActive = useCallback((change: (setlist: Setlist) => Setlist) => {
    setStore((current) => ({
      ...current,
      setlists: current.setlists.map((item) => (item.id === current.activeId ? { ...change(item), updatedAt: new Date().toISOString() } : item)),
    }));
  }, []);

  const setEntries = useCallback((change: (list: SetEntry[]) => SetEntry[]) => updateActive((setlist) => ({ ...setlist, entries: change(setlist.entries) })), [updateActive]);

  const updateEntry = (id: string, patch: Partial<SetEntry>) => setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  // Saved songs are read once so linked entries pick up edits made in the
  // songbook since they were added; the picker reuses the same list.
  const fetchSongs = useCallback(() => listWorks(user?.id ?? null).then((all) => all.filter((item) => item.kind === "song")).catch(() => [] as SavedWork[]), [user]);

  const loadSongs = useCallback(async () => {
    const list = await fetchSongs();
    setSongs(list);
    return list;
  }, [fetchSongs]);

  useEffect(() => {
    let cancelled = false;
    void fetchSongs().then((list) => {
      if (cancelled) return;
      setSongs(list);
      if (!list.length) return;
      setStore((current) => {
        let changed = false;
        const setlists = current.setlists.map((setlist) => {
          const refreshed = refreshLinkedSongs(setlist.entries, list);
          if (refreshed === setlist.entries) return setlist;
          changed = true;
          return { ...setlist, entries: refreshed };
        });
        return changed ? { ...current, setlists } : current;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSongs]);

  // ---- setlists ----

  const createSetlist = () => {
    const next = makeSetlist(`סט חדש ${store.setlists.length + 1}`);
    setStore((current) => ({ ...current, activeId: next.id, setlists: [...current.setlists, next] }));
  };

  const copySetlist = () => {
    const next = duplicateSetlist(active, `${active.name} (עותק)`);
    setStore((current) => ({ ...current, activeId: next.id, setlists: [...current.setlists, next] }));
  };

  const deleteSetlist = () => {
    if (entries.length && !window.confirm(`למחוק את „${active.name || "הסט"}” עם ${entries.length} פריטים?`)) return;
    setStore((current) => {
      const rest = current.setlists.filter((item) => item.id !== current.activeId);
      // There is always one list to work in; deleting the last starts a blank one.
      const setlists = rest.length ? rest : [makeSetlist("ההופעה הבאה")];
      return { ...current, activeId: setlists[0].id, setlists };
    });
  };

  // ---- entries ----

  const [form, setForm] = useState({ title: "", key: "", bpm: "", duration: "4:00", notes: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const addFromForm = (event: FormEvent) => {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setFormError("צריך שם לשיר.");
      return;
    }
    const duration = parseDuration(form.duration || "0");
    if (duration === null) {
      setFormError("את המשך כותבים כמו 3:45, או מספר דקות.");
      return;
    }
    const bpm = form.bpm.trim() ? normalizeBpm(Number(form.bpm)) : null;
    setEntries((list) => [...list, makeSong({ title, key: form.key.trim(), bpm, duration, notes: form.notes.trim() })]);
    setForm((current) => ({ ...current, title: "", key: "", bpm: "", notes: "" }));
    setFormError(null);
    setAnnouncement(`„${title}” נוסף לסט`);
  };

  const addBreak = () => {
    setEntries((list) => [...list, makeBreak(DEFAULT_BREAK_SECONDS)]);
    setAnnouncement("נוספה הפסקה");
  };

  const removeEntry = (id: string) => setEntries((list) => list.filter((entry) => entry.id !== id));

  const move = (id: string, delta: number, focus?: "up" | "down") => {
    const from = entries.findIndex((entry) => entry.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= entries.length) return;
    setEntries((list) => moveEntry(list, from, to));
    setAnnouncement(`הועבר למקום ${to + 1} מתוך ${entries.length}`);
    if (focus) {
      // React may re-insert the row's DOM node, which drops focus; put it back
      // so a keyboard user can press the same button again.
      requestAnimationFrame(() => {
        const row = listRef.current?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`);
        const button = row?.querySelector<HTMLButtonElement>(`[data-move="${focus}"]:not(:disabled)`) ?? row?.querySelector<HTMLButtonElement>("[data-move]:not(:disabled)");
        button?.focus();
      });
    }
  };

  // Pointer-based drag: the row follows the finger by swapping with its
  // neighbour whenever the pointer passes the neighbour's middle. Rows differ
  // in height, so measuring live is simpler and sturdier than a fixed grid.
  // The move and release are heard on the window, not on the handle: when
  // React reorders the rows it moves the dragged row's DOM node, and a moved
  // node loses its pointer capture — handle-only listeners then stopped the
  // drag after the first swap down and never heard the release, leaving the
  // row stuck in its dragging state.
  const onHandleDown = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // Capture still helps until the first swap (a mouse leaving the window); the window listeners take over after.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, pointerId: event.pointerId, pending: false };
    setDraggingId(id);
  };

  useEffect(() => {
    if (!draggingId) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !listRef.current) return;
      const y = event.clientY;
      // Near the viewport's edges the page scrolls, so a long set can be dragged end to end.
      // "instant" because the site sets smooth scrolling, which would queue up animations here.
      if (y < 70) window.scrollBy({ top: -12, behavior: "instant" });
      else if (y > window.innerHeight - 90) window.scrollBy({ top: 12, behavior: "instant" });
      if (drag.pending) return;
      const rows = Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-entry-id]"));
      const index = rows.findIndex((row) => row.dataset.entryId === drag.id);
      if (index < 0) return;
      const above = rows[index - 1]?.getBoundingClientRect();
      const below = rows[index + 1]?.getBoundingClientRect();
      const to = above && y < above.top + above.height / 2 ? index - 1 : below && y > below.top + below.height / 2 ? index + 1 : index;
      if (to === index) return;
      drag.pending = true;
      setEntries((list) => moveEntry(list, index, to));
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDraggingId(null);
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? []);
      const index = rows.findIndex((row) => row.dataset.entryId === drag.id);
      if (index >= 0) setAnnouncement(`הועבר למקום ${index + 1} מתוך ${rows.length}`);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [draggingId, setEntries]);

  useEffect(() => {
    if (dragRef.current) dragRef.current.pending = false;
  }, [entries]);

  // ---- songbook ----

  const openPicker = async () => {
    const next = !pickerOpen;
    setPickerOpen(next);
    setPicked(new Set());
    if (next) await loadSongs();
  };

  const importPicked = () => {
    if (!songs) return;
    const chosen = songs.filter((song) => picked.has(song.id));
    if (!chosen.length) return;
    setEntries((list) => [...list, ...chosen.map((song) => entryFromSong(song))]);
    setAnnouncement(`נוספו ${chosen.length} שירים מהשירון`);
    setPicked(new Set());
    setPickerOpen(false);
  };

  const linkedIds = useMemo(() => new Set(entries.map((entry) => entry.workId).filter(Boolean) as string[]), [entries]);

  const openInSongbook = (entry: SetEntry) => {
    const work = entry.workId ? songs?.find((song) => song.id === entry.workId) : undefined;
    if (work && onOpenWork) {
      onOpenWork(work);
      return;
    }
    if (!entry.songBody) return;
    setSongbookDraft({ title: entry.title, body: entry.songBody });
    window.location.assign("#/songbook");
  };

  // ---- sharing ----

  const plain = setlistToText(active);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(plain);
    } catch {
      // Clipboard permission can be refused (http, iframes); a hidden
      // textarea and execCommand still work in most of those places.
      const area = document.createElement("textarea");
      area.value = plain;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } finally {
        area.remove();
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const print = () => window.setTimeout(() => window.print(), 100);

  const openStage = (at = 0) => {
    if (!entries.length) return false;
    setStageIndex(Math.max(0, Math.min(entries.length - 1, at)));
    setStageOpen(true);
    return true;
  };

  // ---- assistant ----

  useAssistantTool("setlist", {
    state: () =>
      `סט־ליסט „${active.name}”: ${songCountLabel(totals.songCount)}${totals.breakCount ? `, ${breakCountLabel(totals.breakCount)}` : ""}, משך כולל ${formatDuration(totals.total)}${active.targetMinutes ? `, יעד ${active.targetMinutes} דקות` : ""}; ${store.setlists.length} סטים שמורים; מצב במה ${stageOpen ? `פתוח (פריט ${stageIndex + 1})` : "סגור"}.`,
    handlers: {
      "setlist.read": () => ({
        ok: true,
        message: entries.length ? "" : "הסט ריק",
        data: {
          name: active.name,
          total: formatDuration(totals.total),
          totalSeconds: totals.total,
          targetMinutes: active.targetMinutes,
          startTime: active.startTime,
          entries: entries.map((entry, index) =>
            entry.type === "break"
              ? { type: "break", duration: formatDuration(entry.duration), startsAt: formatDuration(starts[index]) }
              : { number: numbers[index], title: entry.title, key: entry.key, bpm: entry.bpm, duration: formatDuration(entry.duration), notes: entry.notes, linkedToSongbook: Boolean(entry.workId), startsAt: formatDuration(starts[index]) },
          ),
          setlists: store.setlists.map((item) => item.name),
        },
      }),
      "setlist.add": ({ title, key, bpm, minutes, notes }) => {
        const name = String(title ?? "").trim();
        if (!name) return { ok: false, message: "חסר שם לשיר" };
        const duration = typeof minutes === "number" && minutes > 0 ? Math.round(minutes * 60) : undefined;
        const entry = makeSong({ title: name, key: typeof key === "string" ? key : "", bpm: normalizeBpm(bpm), duration, notes: typeof notes === "string" ? notes : "" });
        setEntries((list) => [...list, entry]);
        return { ok: true, message: `„${entry.title}” נוסף במקום ${totals.songCount + 1} (${formatDuration(entry.duration)})` };
      },
      "setlist.remove": ({ index }) => {
        const number = Math.round(Number(index));
        const at = numbers.findIndex((value) => value === number);
        if (at < 0) return { ok: false, message: `אין שיר מספר ${index} בסט` };
        const entry = entries[at];
        removeEntry(entry.id);
        return { ok: true, message: `„${entry.title}” הוסר מהסט` };
      },
      "setlist.rename": ({ name }) => {
        const next = String(name ?? "").trim().slice(0, 200);
        if (!next) return { ok: false, message: "חסר שם" };
        updateActive((setlist) => ({ ...setlist, name: next }));
        return { ok: true, message: `הסט נקרא עכשיו „${next}”` };
      },
      "setlist.stage": ({ on }) => {
        if (!on) {
          setStageOpen(false);
          return { ok: true, message: "מצב הבמה נסגר" };
        }
        return openStage(0) ? { ok: true, message: "מצב הבמה נפתח" } : { ok: false, message: "הסט ריק" };
      },
      "setlist.print": () => {
        if (!entries.length) return { ok: false, message: "הסט ריק" };
        print();
        return { ok: true, message: "חלון ההדפסה נפתח" };
      },
    },
  });

  const statusText = target
    ? target.state === "on"
      ? "בדיוק בזמן"
      : target.state === "over"
        ? `ארוך מהיעד ב־${formatDuration(target.diff)}`
        : `קצר מהיעד ב־${formatDuration(target.diff)}`
    : null;

  return (
    <section className="tool-body setlist-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <ListMusic size={26} />
        </span>
        <div>
          <h1>סט־ליסט להופעה</h1>
          <p>בונים את רשימת השירים של הערב, רואים כמה זמן היא נמשכת, ועוברים בין השירים על הבמה במסך מלא.</p>
        </div>
      </div>

      <div className="settings-panel setlist-manage">
        <div className="setlist-manage-row">
          <label className="setlist-field setlist-field-grow">
            <span>הסט</span>
            <select className="field" value={active.id} onChange={(event) => setStore((current) => ({ ...current, activeId: event.target.value }))}>
              {store.setlists.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || "ללא שם"}
                </option>
              ))}
            </select>
          </label>
          <div className="setlist-manage-buttons">
            <button type="button" className="icon-button" onClick={createSetlist} aria-label="סט חדש" title="סט חדש">
              <Plus size={18} />
            </button>
            <button type="button" className="icon-button" onClick={copySetlist} aria-label="שכפול הסט" title="שכפול הסט">
              <CopyPlus size={18} />
            </button>
            <button type="button" className="icon-button is-danger" onClick={deleteSetlist} aria-label="מחיקת הסט" title="מחיקת הסט">
              <Trash2 size={18} />
            </button>
          </div>
        </div>
        <div className="setlist-manage-row">
          <label className="setlist-field setlist-field-grow">
            <span>שם</span>
            <input className="field" value={active.name} onChange={(event) => updateActive((setlist) => ({ ...setlist, name: event.target.value.slice(0, 200) }))} placeholder="למשל: חתונה בחיפה" dir="auto" />
          </label>
          <label className="setlist-field setlist-field-small">
            <span>שעת התחלה</span>
            <input className="field" type="time" value={active.startTime ?? ""} onChange={(event) => updateActive((setlist) => ({ ...setlist, startTime: normalizeStartTime(event.target.value) }))} />
          </label>
          <label className="setlist-field setlist-field-small">
            <span>יעד בדקות</span>
            <input
              className="field"
              type="number"
              min={1}
              max={600}
              inputMode="numeric"
              value={active.targetMinutes ?? ""}
              placeholder="ללא"
              onChange={(event) => {
                const value = Number(event.target.value);
                updateActive((setlist) => ({ ...setlist, targetMinutes: event.target.value && value > 0 ? Math.min(600, Math.round(value)) : null }));
              }}
            />
          </label>
        </div>
      </div>

      <div className={`setlist-summary ${target ? `is-${target.state}` : ""}`} aria-live="polite">
        <div className="setlist-summary-total">
          <span>משך הסט</span>
          <strong dir="ltr">{formatDuration(totals.total)}</strong>
        </div>
        <div className="setlist-summary-parts">
          <span>
            {songCountLabel(totals.songCount)} · <b dir="ltr">{formatDuration(totals.songs)}</b>
          </span>
          {totals.breakCount > 0 && (
            <span>
              {breakCountLabel(totals.breakCount)} · <b dir="ltr">{formatDuration(totals.breaks)}</b>
            </span>
          )}
          {active.startTime && entries.length > 0 && (
            <span>
              סיום משוער <b dir="ltr">{clockAt(active.startTime, totals.total)}</b>
            </span>
          )}
        </div>
        {statusText && <span className="setlist-summary-status">{statusText}</span>}
      </div>

      <div className="workspace-card setlist-card">
        {entries.length === 0 ? (
          <p className="setlist-empty">הסט ריק. הוסיפו שירים ידנית למטה, או ייבאו אותם מהשירון.</p>
        ) : (
          <ol className="setlist-list" ref={listRef} aria-label="השירים בסט">
            {entries.map((entry, index) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                number={numbers[index]}
                time={active.startTime ? clockAt(active.startTime, starts[index]) : `+${formatDuration(starts[index])}`}
                first={index === 0}
                last={index === entries.length - 1}
                dragging={draggingId === entry.id}
                onChange={(patch) => updateEntry(entry.id, patch)}
                onRemove={() => removeEntry(entry.id)}
                onMove={(delta, focus) => move(entry.id, delta, focus)}
                onHandleDown={(event) => onHandleDown(event, entry.id)}
                onOpenSong={entry.workId || entry.songBody ? () => openInSongbook(entry) : undefined}
                onStage={() => openStage(index)}
              />
            ))}
          </ol>
        )}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        <form className="setlist-add" onSubmit={addFromForm}>
          <h2>הוספת שיר</h2>
          <div className="setlist-add-grid">
            <label className="setlist-field setlist-add-title">
              <span>שם השיר</span>
              <input className="field" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} dir="auto" />
            </label>
            <label className="setlist-field">
              <span>סולם</span>
              <input className="field" value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} placeholder="Am" dir="ltr" />
            </label>
            <label className="setlist-field">
              <span>BPM</span>
              <input className="field" type="number" min={20} max={400} inputMode="numeric" value={form.bpm} onChange={(event) => setForm({ ...form, bpm: event.target.value })} />
            </label>
            <label className="setlist-field">
              <span>משך</span>
              <input className="field" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} placeholder="3:45" dir="ltr" inputMode="numeric" />
            </label>
            <label className="setlist-field setlist-add-notes">
              <span>הערות</span>
              <input className="field" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="קאפו 2, גיטרה אקוסטית" dir="auto" />
            </label>
          </div>
          {formError && (
            <p className="error-message" role="alert">
              {formError}
            </p>
          )}
          <div className="setlist-add-actions">
            <button type="submit" className="primary-button compact">
              <Plus size={17} /> הוסף שיר
            </button>
            <button type="button" className="secondary-button" onClick={addBreak}>
              <Coffee size={17} /> הוסף הפסקה
            </button>
            <button type="button" className="secondary-button" onClick={() => void openPicker()} aria-expanded={pickerOpen}>
              <FolderOpen size={17} /> ייבוא מהשירון
            </button>
          </div>
        </form>

        {pickerOpen && (
          <div className="setlist-picker" role="group" aria-label="שירים שמורים בשירון">
            {songs === null && <p className="table-footnote">טוען…</p>}
            {songs && songs.length === 0 && (
              <p className="table-footnote">
                עדיין אין שירים שמורים בשירון. <a href="#/songbook">לשירון</a>
              </p>
            )}
            {songs && songs.length > 0 && (
              <>
                <ul className="setlist-picker-list">
                  {songs.map((song) => (
                    <li key={song.id}>
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={picked.has(song.id)}
                          onChange={(event) =>
                            setPicked((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(song.id);
                              else next.delete(song.id);
                              return next;
                            })
                          }
                        />
                        <span dir="auto">{song.title}</span>
                        {linkedIds.has(song.id) && <small className="setlist-picker-note">כבר בסט</small>}
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="setlist-add-actions">
                  <button type="button" className="primary-button compact" onClick={importPicked} disabled={!picked.size}>
                    <Plus size={17} /> הוסף {picked.size ? songCountLabel(picked.size) : "שירים"}
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setPicked(new Set(songs.map((song) => song.id)))}>
                    בחר הכול
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="setlist-actions">
        <button type="button" className="primary-button setlist-stage-button" onClick={() => openStage(0)} disabled={!entries.length}>
          <Maximize size={19} /> מצב במה
        </button>
        <button type="button" className="secondary-button" onClick={print} disabled={!entries.length}>
          <Printer size={17} /> הדפסה
        </button>
        <button type="button" className="secondary-button" onClick={() => void copyText()} disabled={!entries.length}>
          {copied ? <Check size={17} /> : <Copy size={17} />} {copied ? "הועתק" : "העתק כטקסט"}
        </button>
        <a className={`secondary-button ${entries.length ? "" : "is-disabled"}`} href={`https://wa.me/?text=${encodeURIComponent(plain)}`} target="_blank" rel="noopener noreferrer" aria-disabled={!entries.length} onClick={(event) => !entries.length && event.preventDefault()}>
          <MessageCircle size={17} /> שליחה בוואטסאפ
        </a>
      </div>
      {storageFailed && <p className="notice-message">הדפדפן לא מאפשר לשמור כאן. הסט יישאר רק עד שהדף ייסגר.</p>}

      <PrintSheet setlist={active} />

      {stageOpen && entries.length > 0 && (
        <StageMode entries={entries} numbers={numbers} starts={starts} index={Math.min(stageIndex, entries.length - 1)} onIndex={setStageIndex} onClose={() => setStageOpen(false)} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

type RowProps = {
  entry: SetEntry;
  number: number | null;
  time: string;
  first: boolean;
  last: boolean;
  dragging: boolean;
  onChange: (patch: Partial<SetEntry>) => void;
  onRemove: () => void;
  onMove: (delta: number, focus: "up" | "down") => void;
  onHandleDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onOpenSong?: () => void;
  onStage: () => void;
};

function EntryRow({ entry, number, time, first, last, dragging, onChange, onRemove, onMove, onHandleDown, onOpenSong, onStage }: RowProps) {
  const isBreak = entry.type === "break";
  const label = isBreak ? entry.title || "הפסקה" : entry.title || "שיר";
  return (
    <li className={`setlist-row ${isBreak ? "is-break" : ""} ${dragging ? "is-dragging" : ""}`} data-entry-id={entry.id}>
      <div className="setlist-row-head">
        <button
          type="button"
          className="setlist-handle"
          aria-label={`גרירת „${label}” לשינוי הסדר`}
          title="גררו לשינוי הסדר"
          tabIndex={-1}
          onPointerDown={onHandleDown}
        >
          <GripVertical size={18} />
        </button>
        <span className="setlist-num" aria-hidden={isBreak}>
          {isBreak ? <Coffee size={16} /> : number}
        </span>
        <input
          className="field setlist-row-title"
          value={entry.title}
          onChange={(event) => onChange({ title: event.target.value.slice(0, 200) })}
          placeholder={isBreak ? "הפסקה" : "שם השיר"}
          aria-label={isBreak ? "שם ההפסקה" : `שם שיר מספר ${number}`}
          dir="auto"
        />
        <span className="setlist-row-time" dir="ltr" title="שעת התחלה">
          {time}
        </span>
      </div>
      <div className="setlist-row-body">
        {!isBreak && (
          <>
            <label className="setlist-mini">
              <span>סולם</span>
              <input className="field" value={entry.key} onChange={(event) => onChange({ key: event.target.value.slice(0, 40) })} dir="ltr" />
            </label>
            <label className="setlist-mini">
              <span>BPM</span>
              <input className="field" type="number" min={20} max={400} inputMode="numeric" value={entry.bpm ?? ""} onChange={(event) => onChange({ bpm: event.target.value ? normalizeBpm(Number(event.target.value)) : null })} />
            </label>
          </>
        )}
        <label className="setlist-mini">
          <span>משך</span>
          <DurationInput seconds={entry.duration} onChange={(duration) => onChange({ duration })} />
        </label>
        {!isBreak && (
          <label className="setlist-mini setlist-mini-notes">
            <span>הערות</span>
            <input className="field" value={entry.notes} onChange={(event) => onChange({ notes: event.target.value.slice(0, 500) })} placeholder="קאפו, כלי, מי פותח" dir="auto" />
          </label>
        )}
        <div className="setlist-row-actions">
          {onOpenSong && (
            <button type="button" className="icon-button" onClick={onOpenSong} aria-label={`פתיחת „${label}” בשירון`} title="פתיחה בשירון">
              <BookOpen size={17} />
            </button>
          )}
          <button type="button" className="icon-button" onClick={onStage} aria-label={`מצב במה מ„${label}”`} title="מצב במה מכאן">
            <Maximize size={16} />
          </button>
          <button type="button" className="icon-button" data-move="up" onClick={() => onMove(-1, "up")} disabled={first} aria-label={`הזזת „${label}” למעלה`} title="למעלה">
            <ArrowUp size={17} />
          </button>
          <button type="button" className="icon-button" data-move="down" onClick={() => onMove(1, "down")} disabled={last} aria-label={`הזזת „${label}” למטה`} title="למטה">
            <ArrowDown size={17} />
          </button>
          <button type="button" className="icon-button is-danger" onClick={onRemove} aria-label={`הסרת „${label}”`} title="הסרה">
            <Trash2 size={17} />
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * A duration field that lets the musician type freely ("3:4" on the way to
 * "3:45") and only commits a valid value on blur or Enter; a typo reverts.
 */
function DurationInput({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseDuration(draft);
    if (parsed !== null) onChange(parsed);
    setDraft(null);
  };
  const invalid = draft !== null && draft.trim() !== "" && parseDuration(draft) === null;
  return (
    <input
      className={`field ${invalid ? "is-invalid" : ""}`}
      value={draft ?? formatDuration(seconds)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      aria-invalid={invalid}
      dir="ltr"
      inputMode="numeric"
    />
  );
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

/** Hidden on screen; the only thing on the page when printing. Big type, so it reads from the floor by the pedalboard. */
function PrintSheet({ setlist }: { setlist: Setlist }) {
  const numbers = songNumbers(setlist.entries);
  const starts = runningStarts(setlist.entries);
  const totals = setTotals(setlist.entries);
  return (
    <div className="setlist-print" aria-hidden="true">
      <h2>{setlist.name || "סט־ליסט"}</h2>
      <ol>
        {setlist.entries.map((entry, index) =>
          entry.type === "break" ? (
            <li key={entry.id} className="is-break">
              — {entry.title || "הפסקה"} {formatDuration(entry.duration)} —
            </li>
          ) : (
            <li key={entry.id}>
              <span className="setlist-print-num">{numbers[index]}</span>
              <span className="setlist-print-title">{entry.title}</span>
              <span className="setlist-print-meta" dir="ltr">
                {[entry.key, entry.bpm ? `${entry.bpm}` : ""].filter(Boolean).join(" · ")}
              </span>
              {entry.notes && <span className="setlist-print-notes">{entry.notes}</span>}
              {setlist.startTime && (
                <span className="setlist-print-time" dir="ltr">
                  {clockAt(setlist.startTime, starts[index])}
                </span>
              )}
            </li>
          ),
        )}
      </ol>
      <p>
        סה״כ {formatDuration(totals.total)} · {songCountLabel(totals.songCount)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage mode
// ---------------------------------------------------------------------------

type StageProps = {
  entries: SetEntry[];
  numbers: (number | null)[];
  starts: number[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
};

type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };

function fullscreenElement() {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function StageMode({ entries, numbers, starts, index, onIndex, onClose }: StageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pulse, setPulse] = useState(true);
  const [click, setClick] = useState(false);
  const [lyrics, setLyrics] = useState(false);
  const [timer, setTimer] = useState<{ startedAt: number | null; banked: number }>({ startedAt: null, banked: 0 });
  const [now, setNow] = useState(() => Date.now());

  const entry = entries[index];
  const next = entries[index + 1];
  const total = starts.length ? starts[starts.length - 1] + entries[entries.length - 1].duration : 0;
  const bpm = entry.type === "song" ? entry.bpm : null;

  const go = useCallback((delta: number) => onIndex(Math.max(0, Math.min(entries.length - 1, index + delta))), [entries.length, index, onIndex]);

  // Fullscreen is asked for on open (the click that opened the stage counts
  // as the user gesture). If the browser says no — iOS Safari on a phone,
  // an iframe — the fixed overlay already covers the page, which is enough.
  const enterFullscreen = useCallback(async () => {
    const element = rootRef.current as FullscreenElement | null;
    if (!element) return;
    try {
      if (element.requestFullscreen) await element.requestFullscreen();
      else await element.webkitRequestFullscreen?.();
    } catch {
      // The overlay stays as the fallback.
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    const doc = document as FullscreenDocument;
    if (!fullscreenElement()) return;
    try {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
    } catch {
      // Already out.
    }
  }, []);

  // Focus moves into the stage so its keys start at once and a screen reader
  // lands in the dialog, and goes back to where it was when the stage closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Opened by the assistant while the visitor types to it: the text box keeps the focus.
    if (!isTyping(previous)) rootRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    void enterFullscreen();
    const onChange = () => setIsFullscreen(Boolean(fullscreenElement()));
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    // The page underneath must not scroll while the stage is up.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      document.body.style.overflow = overflow;
      void exitFullscreen();
    };
  }, [enterFullscreen, exitFullscreen]);

  // Keep the phone awake for the whole gig. The lock is dropped by the
  // browser whenever the tab is hidden, so it is asked for again on return.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (!wakeLock || document.visibilityState !== "visible") return;
        const next = await wakeLock.request("screen");
        if (cancelled) void next.release().catch(() => undefined);
        else lock = next;
      } catch {
        // Unsupported, denied, or low battery: the stage still works.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  // Foot pedals (AirTurn, PageFlip and the like) send arrows, Page Up/Down
  // or space. The pedal's "forward" is Right/Down/PageDown whatever the page
  // direction, so those move forward here too, even though the page is RTL.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const root = rootRef.current;
      // Tab stays inside the stage: it is a modal layer, and focus wandering
      // onto the page behind it would send the pedal's keys there.
      if (event.key === "Tab" && root) {
        const focusable = Array.from(root.querySelectorAll<HTMLElement>("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const inside = root.contains(document.activeElement);
        if (event.shiftKey && (!inside || document.activeElement === first || document.activeElement === root)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      // Enter and Space on a focused control press that control (a keyboard
      // user toggling the click, or the assistant's send button); swallowing
      // them here made every button unreachable from the keyboard.
      const target = event.target as HTMLElement | null;
      if ((event.key === "Enter" || event.key === " ") && target && target !== root && target.closest("button, a, summary, [role=button]")) return;
      const forward = ["ArrowRight", "ArrowDown", "PageDown", "Enter"].includes(event.key) || (event.key === " " && !event.shiftKey);
      const back = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(event.key) || (event.key === " " && event.shiftKey);
      if (forward) go(1);
      else if (back) go(-1);
      else if (event.key === "Home") onIndex(0);
      else if (event.key === "End") onIndex(entries.length - 1);
      else if (event.key === "Escape" && !fullscreenElement()) onClose();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries.length, go, onClose, onIndex]);

  // The set timer ticks once a second only while it runs.
  useEffect(() => {
    if (timer.startedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [timer.startedAt]);
  const elapsed = Math.floor((timer.banked + (timer.startedAt !== null ? now - timer.startedAt : 0)) / 1000);

  // A tiny click at the song's tempo, scheduled ahead on the audio clock
  // (timers alone drift audibly). One context for the stage's lifetime.
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!click || !bpm) return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = audioRef.current ?? new AudioContextClass();
    audioRef.current = audio;
    void audio.resume();
    const beat = 60 / bpm;
    let nextAt = audio.currentTime + 0.05;
    let count = 0;
    const schedule = () => {
      while (nextAt < audio.currentTime + 0.12) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = count % 4 === 0 ? 1200 : 850;
        gain.gain.setValueAtTime(0.0001, nextAt);
        gain.gain.exponentialRampToValueAtTime(0.4, nextAt + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, nextAt + 0.05);
        osc.connect(gain).connect(audio.destination);
        osc.start(nextAt);
        osc.stop(nextAt + 0.06);
        nextAt += beat;
        count += 1;
      }
    };
    schedule();
    const id = window.setInterval(schedule, 25);
    return () => window.clearInterval(id);
  }, [bpm, click]);
  useEffect(() => () => void audioRef.current?.close().catch(() => undefined), []);

  const toggleTimer = () => {
    const at = Date.now();
    setNow(at);
    setTimer((current) => (current.startedAt === null ? { ...current, startedAt: at } : { startedAt: null, banked: current.banked + (at - current.startedAt) }));
  };

  const hasLyrics = entry.type === "song" && Boolean(entry.songBody);
  const showLyrics = lyrics && hasLyrics;
  const planned = starts[index];
  const behind = timer.startedAt !== null || timer.banked > 0 ? elapsed - planned : null;

  const stage = (
    <div
      ref={rootRef}
      className={`setlist-stage ${showLyrics ? "has-lyrics" : ""} ${entry.type === "break" ? "is-break" : ""}`}
      style={{ "--accent-hue": HUE } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="מצב במה"
      tabIndex={-1}
    >
      <header className="setlist-stage-top">
        <span className="setlist-stage-position" dir="ltr">
          {index + 1} / {entries.length}
        </span>
        <div className="setlist-stage-timer">
          <button type="button" className="setlist-stage-chip" onClick={toggleTimer} aria-pressed={timer.startedAt !== null} aria-label={timer.startedAt !== null ? "עצירת שעון הסט" : "הפעלת שעון הסט"}>
            {timer.startedAt !== null ? <Pause size={16} /> : <Timer size={16} />}
            <span dir="ltr">{formatDuration(elapsed)}</span>
            <small dir="ltr">/ {formatDuration(total)}</small>
          </button>
          {(timer.startedAt !== null || timer.banked > 0) && (
            <button type="button" className="setlist-stage-chip is-icon" onClick={() => setTimer({ startedAt: null, banked: 0 })} aria-label="איפוס שעון הסט">
              <RotateCcw size={16} />
            </button>
          )}
          {behind !== null && Math.abs(behind) >= 60 && <span className={`setlist-stage-drift ${behind > 0 ? "is-late" : "is-early"}`}>{behind > 0 ? `באיחור ${formatDuration(behind)}` : `מקדימים ${formatDuration(behind)}`}</span>}
        </div>
        <div className="setlist-stage-toggles">
          <button type="button" className={`setlist-stage-chip ${pulse ? "is-on" : ""}`} onClick={() => setPulse((value) => !value)} aria-pressed={pulse}>
            <span className="setlist-stage-dot-icon" aria-hidden="true" /> פעימה
          </button>
          <button type="button" className={`setlist-stage-chip ${click ? "is-on" : ""}`} onClick={() => setClick((value) => !value)} aria-pressed={click} disabled={!bpm}>
            {click ? <Volume2 size={16} /> : <VolumeX size={16} />} קליק
          </button>
          <button type="button" className={`setlist-stage-chip ${lyrics ? "is-on" : ""}`} onClick={() => setLyrics((value) => !value)} aria-pressed={lyrics}>
            <BookOpen size={16} /> מילים ואקורדים
          </button>
          <button type="button" className="setlist-stage-chip is-icon" onClick={() => void (isFullscreen ? exitFullscreen() : enterFullscreen())} aria-label={isFullscreen ? "יציאה ממסך מלא" : "מסך מלא"}>
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
        <button type="button" className="setlist-stage-chip is-icon setlist-stage-close" onClick={onClose} aria-label="סגירת מצב הבמה">
          <X size={18} />
        </button>
      </header>

      <main className="setlist-stage-main" aria-live="polite">
        <div className="setlist-stage-now">
          <span className="setlist-stage-label">{entry.type === "break" ? "הפסקה" : `שיר ${numbers[index]}`}</span>
          <h2 className="setlist-stage-title" dir="auto">
            {entry.title || (entry.type === "break" ? "הפסקה" : "ללא שם")}
          </h2>
          <div className="setlist-stage-meta">
            {entry.type === "song" && entry.key && (
              <span className="setlist-stage-key" dir="ltr">
                {entry.key}
              </span>
            )}
            {bpm && (
              <span className="setlist-stage-bpm" dir="ltr">
                {pulse && <i key={`${entry.id}-${bpm}`} className="setlist-stage-dot" style={{ animationDuration: `${60 / bpm}s` }} aria-hidden="true" />}
                {bpm} <small>BPM</small>
              </span>
            )}
            <span className="setlist-stage-length" dir="ltr">
              {formatDuration(entry.duration)}
            </span>
          </div>
          {entry.type === "song" && entry.notes && (
            <p className="setlist-stage-notes" dir="auto">
              {entry.notes}
            </p>
          )}
          {lyrics && entry.type === "song" && !hasLyrics && <p className="setlist-stage-nolyrics">לשיר הזה אין מילים מהשירון.</p>}
        </div>
        {showLyrics && entry.songBody && (
          <div className="setlist-stage-lyrics" key={entry.id}>
            <SongSheet body={entry.songBody} transpose={entry.songTranspose} />
          </div>
        )}
      </main>

      <footer className="setlist-stage-bottom">
        <button type="button" className="setlist-stage-nav" onClick={() => go(-1)} disabled={index === 0} aria-label="לשיר הקודם">
          <ChevronRight size={34} />
          <span>הקודם</span>
        </button>
        <div className="setlist-stage-next">
          {next ? (
            <>
              <small>הבא</small>
              <strong dir="auto">{next.type === "break" ? next.title || "הפסקה" : next.title || "ללא שם"}</strong>
              {next.type === "song" && (next.key || next.bpm) && (
                <span dir="ltr">{[next.key, next.bpm ? `${next.bpm} BPM` : ""].filter(Boolean).join(" · ")}</span>
              )}
            </>
          ) : (
            <strong>סוף הסט</strong>
          )}
        </div>
        <button type="button" className="setlist-stage-nav is-next" onClick={() => go(1)} disabled={index >= entries.length - 1} aria-label="לשיר הבא">
          <span>הבא</span>
          <ChevronLeft size={34} />
        </button>
      </footer>
    </div>
  );

  return createPortal(stage, document.body);
}

/**
 * The linked song as the songbook lays it out — chords over the words they
 * fall on — reusing the songbook's parser and its CSS classes, so a sheet
 * looks the same on stage as it does in the songbook.
 */
function SongSheet({ body, transpose }: { body: string; transpose: number }) {
  const lines = useMemo(() => parseSong(transposeSong(body, transpose)), [body, transpose]);
  return (
    <div className="setlist-sheet" dir="auto" translate="no">
      {lines.map((line, index) => {
        if (line.kind === "blank") return <div key={index} className="songbook-blank" />;
        if (line.kind === "heading")
          return (
            <h3 key={index} dir="auto">
              {line.lyric}
            </h3>
          );
        if (!line.chords.length)
          return (
            <p key={index} dir="auto">
              {line.lyric}
            </p>
          );
        const pieces: { chord: string | null; text: string }[] = [];
        let cursor = 0;
        line.chords.forEach((chord, at) => {
          if (chord.at > cursor) pieces.push({ chord: null, text: line.lyric.slice(cursor, chord.at) });
          const end = line.chords[at + 1]?.at ?? line.lyric.length;
          pieces.push({ chord: chord.name, text: line.lyric.slice(chord.at, end) || " " });
          cursor = end;
        });
        if (cursor < line.lyric.length) pieces.push({ chord: null, text: line.lyric.slice(cursor) });
        return (
          <p key={index} className="songbook-line" dir="auto">
            {pieces.map((piece, at) => (
              <span key={at} className={`songbook-piece ${piece.chord && !piece.text.trim() ? "is-bare" : ""}`}>
                <span className="songbook-chord" dir="ltr">
                  {piece.chord ?? " "}
                </span>
                <span className="songbook-word">{piece.text}</span>
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
