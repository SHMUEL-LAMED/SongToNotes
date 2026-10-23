import { ArrowRight, Check, CloudOff, MessageSquarePlus, MessagesSquare, Pencil, Pin, PinOff, Search, Trash2, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Chat } from "../lib/assistantChats";
import { chatDidActions, historySections, readPins, visibleCount, writePins } from "../lib/chatHistory";

type Props = {
  /** Null while the list is still on its way. */
  chats: Chat[] | null;
  currentId: string;
  userId: string | null;
  onOpen: (chat: Chat) => void;
  onNew: () => void;
  onBack: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

const timeFormat = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short" });
const yearFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", year: "numeric" });

/** Today's threads by the hour, this year's by the day, older ones with the year. */
function whenLabel(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() === now.toDateString()) return timeFormat.format(date);
  return (date.getFullYear() === now.getFullYear() ? dayFormat : yearFormat).format(date);
}

/**
 * The assistant's history, as a page of its own inside the panel: search
 * through every conversation, the pinned ones on top and the rest by date,
 * a line of each under its title, and rename, pin and delete in place.
 * Deleting asks once, in the row itself.
 */
export function AssistantHistory({ chats, currentId, userId, onOpen, onNew, onBack, onRename, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [pins, setPins] = useState<Set<string>>(() => readPins(userId));
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, []);

  const sections = useMemo(() => historySections(chats ?? [], { query, pinned: pins }), [chats, query, pins]);
  const total = useMemo(() => (chats ?? []).filter((chat) => visibleCount(chat) > 0).length, [chats]);

  const togglePin = (id: string) => {
    setPins((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writePins(userId, next);
      return next;
    });
  };

  const commitRename = () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    setRenaming(null);
    if (title) onRename(renaming.id, title);
  };

  const remove = (id: string) => {
    setDeleting(null);
    if (pins.has(id)) togglePin(id);
    onDelete(id);
  };

  return (
    <section className="assistant-history" aria-label="שיחות קודמות">
      <div className="assistant-history-top">
        <button type="button" className="icon-button" onClick={onBack} aria-label="חזרה לשיחה" title="חזרה לשיחה">
          <ArrowRight size={17} />
        </button>
        <div className="assistant-history-title">
          <strong>שיחות קודמות</strong>
          <small>{chats === null ? "טוען…" : total === 1 ? "שיחה אחת" : `${total} שיחות`}</small>
        </div>
        <button type="button" className="assistant-history-new" onClick={onNew}>
          <MessageSquarePlus size={15} /> שיחה חדשה
        </button>
      </div>

      <label className="assistant-history-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Escape empties the search first; with nothing typed it belongs to the panel.
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
            }
          }}
          placeholder="חיפוש בכותרות ובתוכן השיחות"
          aria-label="חיפוש בשיחות"
          dir="auto"
        />
        {query && (
          <button type="button" className="icon-button" onClick={() => setQuery("")} aria-label="ניקוי החיפוש">
            <X size={14} />
          </button>
        )}
      </label>

      <div className="assistant-history-body">
        {chats === null ? (
          <div className="assistant-history-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : total === 0 ? (
          <div className="assistant-history-empty">
            <MessagesSquare size={26} />
            <strong>עדיין אין שיחות שמורות</strong>
            <p>כל שיחה נשמרת מעצמה{userId ? " ומסונכרנת לחשבון, כך שתמצא אותה בכל מכשיר" : " במכשיר הזה; התחברות תסנכרן אותה לכל המכשירים"}.</p>
          </div>
        ) : sections.length === 0 ? (
          <div className="assistant-history-empty">
            <Search size={24} />
            <strong>לא נמצאו שיחות</strong>
            <p>אין שיחה שבה מופיע „{query.trim()}”. אפשר לנסות מילה אחרת.</p>
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.group} className="assistant-history-group">
              <h3>
                {section.group === "pinned" && <Pin size={12} />}
                {section.label}
                <span>{section.entries.length}</span>
              </h3>
              <ul className="assistant-history-list">
                {section.entries.map(({ chat, preview, pinned }) => {
                  const current = chat.id === currentId;
                  const count = visibleCount(chat);
                  if (renaming?.id === chat.id) {
                    return (
                      <li key={chat.id} className="is-editing">
                        <form
                          className="assistant-history-rename"
                          onSubmit={(event) => {
                            event.preventDefault();
                            commitRename();
                          }}
                        >
                          <input
                            autoFocus
                            value={renaming.title}
                            maxLength={80}
                            aria-label="שם השיחה"
                            dir="auto"
                            onChange={(event) => setRenaming({ id: chat.id, title: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.stopPropagation();
                                setRenaming(null);
                              }
                            }}
                          />
                          <button type="submit" className="icon-button" aria-label="שמור שם">
                            <Check size={15} />
                          </button>
                          <button type="button" className="icon-button" onClick={() => setRenaming(null)} aria-label="ביטול">
                            <X size={15} />
                          </button>
                        </form>
                      </li>
                    );
                  }
                  if (deleting === chat.id) {
                    return (
                      <li key={chat.id} className="is-deleting" role="alertdialog" aria-label={`מחיקת ${chat.title}`}>
                        <p>
                          למחוק את <b dir="auto">{chat.title}</b>? {userId && !chat.localOnly ? "היא תימחק מכל המכשירים." : "אי אפשר לשחזר."}
                        </p>
                        <div>
                          <button type="button" className="assistant-history-danger" onClick={() => remove(chat.id)} autoFocus>
                            <Trash2 size={14} /> מחק
                          </button>
                          <button type="button" className="link-button" onClick={() => setDeleting(null)}>
                            ביטול
                          </button>
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li key={chat.id} className={current ? "is-current" : ""}>
                      <button type="button" className="assistant-history-open" onClick={() => onOpen(chat)} aria-current={current ? "true" : undefined}>
                        <span className="assistant-history-row">
                          <span className="assistant-history-name" dir="auto">
                            {chat.title}
                          </span>
                          <time dateTime={chat.updatedAt}>{whenLabel(chat.updatedAt)}</time>
                        </span>
                        {preview && (
                          <span className="assistant-history-preview" dir="auto">
                            {preview}
                          </span>
                        )}
                        <span className="assistant-history-meta">
                          {current && <em>פתוחה עכשיו</em>}
                          <span>{count === 1 ? "הודעה אחת" : `${count} הודעות`}</span>
                          {chatDidActions(chat) && (
                            <span title="הסוכן ביצע פעולות באתר בשיחה הזאת">
                              <Zap size={11} /> פעולות
                            </span>
                          )}
                          {chat.localOnly && userId && (
                            <span title="עדיין לא סונכרנה לחשבון">
                              <CloudOff size={11} /> רק במכשיר הזה
                            </span>
                          )}
                        </span>
                      </button>
                      <div className="assistant-history-actions">
                        <button
                          type="button"
                          className={`icon-button ${pinned ? "is-on" : ""}`}
                          onClick={() => togglePin(chat.id)}
                          aria-label={pinned ? `ביטול הצמדה של ${chat.title}` : `הצמדה של ${chat.title}`}
                          aria-pressed={pinned}
                          title={pinned ? "ביטול הצמדה" : "הצמד למעלה"}
                        >
                          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
                        </button>
                        <button type="button" className="icon-button" onClick={() => setRenaming({ id: chat.id, title: chat.title })} aria-label={`שנה שם ל${chat.title}`} title="שינוי שם">
                          <Pencil size={14} />
                        </button>
                        <button type="button" className="icon-button is-danger" onClick={() => setDeleting(chat.id)} aria-label={`מחק את ${chat.title}`} title="מחיקה">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
