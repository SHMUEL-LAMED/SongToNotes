import { AudioWaveform, Clock3, History, LogOut, Save, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import {
  deleteTranscription,
  listTranscriptions,
  type SavedTranscription,
} from "../lib/history";
import {
  deleteRingtone,
  listLocalRingtones,
  listRingtones,
  type SavedRingtone,
} from "../lib/ringtoneHistory";
import { moveTabFocus } from "../lib/tablist";

type Props = {
  open: boolean;
  refreshToken: number;
  onClose: () => void;
  onOpenItem: (item: SavedTranscription) => void;
};

const savedDateFormat = new Intl.DateTimeFormat("he-IL", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatSavedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : savedDateFormat.format(date);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function AccountPanel({ open, refreshToken, onClose, onOpenItem }: Props) {
  const { user, profile, updateName, signOut } = useAuth();
  // `null` means "untouched", so the field follows the profile until the
  // visitor types — the profile arrives after this panel first renders.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const name = nameDraft ?? profile?.full_name ?? "";
  const [items, setItems] = useState<SavedTranscription[]>([]);
  const [ringtones, setRingtones] = useState<SavedRingtone[]>([]);
  const [historyTab, setHistoryTab] = useState<"notes" | "ringtones">("notes");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Held in a ref so the trap below depends only on whether the panel is open.
  // Keying it on the callback would re-arm — and so re-steal the focus — on
  // every render of the page around it.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // A panel that claims `aria-modal` has to behave like one: Escape closes it,
  // Tab stays inside it, and the button that opened it gets the focus back.
  useEffect(() => {
    if (!open || !user) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const stops = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
      returnFocusRef.current?.focus();
    };
  }, [open, user]);

  useEffect(() => {
    if (!open || !user) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setMessage("");
      const notes = listTranscriptions(user.id)
        .then((nextItems) => {
          if (active) setItems(nextItems);
        })
        .catch(() => {
          if (active) setMessage("לא הצלחנו לטעון את ההיסטוריה.");
        });
      // A profile that cannot be reached still shows what this device made.
      const tones = listRingtones(user.id)
        .then((nextRingtones) => {
          if (active) setRingtones(nextRingtones);
        })
        .catch(() => {
          if (active) setRingtones(listLocalRingtones());
        });
      void Promise.all([notes, tones]).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, refreshToken, user]);

  if (!open || !user) return null;

  return (
    <div className="account-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        className="account-panel"
        role="dialog"
        aria-modal="true"
        aria-label="הפרופיל וההיסטוריה שלי"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="account-panel-header">
          <div><UserRound size={20} /><strong>הפרופיל שלי</strong></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="סגור">
            <X size={19} />
          </button>
        </div>

        <div className="profile-card">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="profile-placeholder"><UserRound size={27} /></span>
          )}
          <div><strong>{profile?.full_name || "החשבון שלי"}</strong><span>{user.email}</span></div>
        </div>

        <label className="profile-name-field">
          <span>השם שיוצג באתר</span>
          <div>
            <input value={name} maxLength={80} onChange={(event) => setNameDraft(event.target.value)} />
            <button
              type="button"
              className="secondary-button"
              disabled={!name.trim() || name.trim() === profile?.full_name}
              onClick={() => {
                setMessage("");
                void updateName(name)
                  .then(() => {
                    setNameDraft(null);
                    setMessage("השם נשמר.");
                  })
                  .catch(() => setMessage("לא הצלחנו לשמור את השם."));
              }}
            ><Save size={16} /> שמור</button>
          </div>
        </label>

        <div className="history-heading"><History size={19} /><strong>ההיסטוריה המלאה שלי</strong></div>
        <div className="history-tabs" role="tablist" aria-label="סוג היסטוריה">
          <button type="button" role="tab" id="history-tab-notes" aria-controls="history-panel" aria-selected={historyTab === "notes"} tabIndex={historyTab === "notes" ? 0 : -1} onKeyDown={moveTabFocus} className={historyTab === "notes" ? "active" : ""} onClick={() => setHistoryTab("notes")}>תווים <span>{items.length}</span></button>
          <button type="button" role="tab" id="history-tab-ringtones" aria-controls="history-panel" aria-selected={historyTab === "ringtones"} tabIndex={historyTab === "ringtones" ? 0 : -1} onKeyDown={moveTabFocus} className={historyTab === "ringtones" ? "active" : ""} onClick={() => setHistoryTab("ringtones")}>צלצולים <span>{ringtones.length}</span></button>
        </div>
        <div className="history-list" id="history-panel" role="tabpanel" aria-labelledby={`history-tab-${historyTab}`}>
          {loading ? (
            <p className="empty-history">טוען את ההיסטוריה…</p>
          ) : historyTab === "notes" && items.length === 0 ? (
            <p className="empty-history">עדיין אין תוצאות שמורות. התוצאה הראשונה תישמר כאן אוטומטית.</p>
          ) : historyTab === "notes" ? (
            items.map((item) => (
              <article className="history-item" key={item.id}>
                <button className="history-open" type="button" onClick={() => onOpenItem(item)}>
                  <span className="history-note"><MusicNote /></span>
                  <span><strong>{item.title}</strong><small><Clock3 size={13} /> {formatSavedDate(item.created_at)} · {item.note_count} תווים</small></span>
                </button>
                <button
                  className="history-delete"
                  type="button"
                  aria-label={`מחק את ${item.title}`}
                  onClick={() => {
                    if (!window.confirm(`למחוק את „${item.title}” מההיסטוריה?`)) return;
                    void deleteTranscription(item.id, user.id)
                      .then(() => setItems((current) => current.filter((entry) => entry.id !== item.id)))
                      .catch(() => setMessage("לא הצלחנו למחוק את היצירה."));
                  }}
                ><Trash2 size={16} /></button>
              </article>
            ))
          ) : ringtones.length === 0 ? (
            <p className="empty-history">עדיין אין צלצולים שמורים. אחרי הורדת צלצול הוא יופיע כאן אוטומטית.</p>
          ) : (
            ringtones.map((item) => (
              <article className="history-item" key={item.id}>
                <a className="history-open" href="https://shmuel-lamed.github.io/Ringtones/">
                  <span className="history-note ringtone"><AudioWaveform size={19} /></span>
                  <span><strong>{item.title}</strong><small><Clock3 size={13} /> {formatSavedDate(item.createdAt)} · {Math.round(item.durationSeconds)} שניות</small></span>
                </a>
                <button className="history-delete" type="button" aria-label={`מחק את ${item.title}`} onClick={() => {
                  if (!window.confirm(`למחוק את „${item.title}” מההיסטוריה?`)) return;
                  void deleteRingtone(item.id, user.id)
                    .then(() => setRingtones((current) => current.filter((entry) => entry.id !== item.id)))
                    .catch(() => setMessage("לא הצלחנו למחוק את הצלצול."));
                }}><Trash2 size={16} /></button>
              </article>
            ))
          )}
        </div>
        {message && <p className="account-message" role="status">{message}</p>}
        <button className="logout-button" type="button" onClick={() => void signOut()}>
          <LogOut size={17} /> יציאה מהחשבון
        </button>
      </aside>
    </div>
  );
}

function MusicNote() {
  return <span aria-hidden="true">♫</span>;
}
