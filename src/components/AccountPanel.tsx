import { Clock3, History, LogOut, Save, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import {
  deleteTranscription,
  listTranscriptions,
  type SavedTranscription,
} from "../lib/history";

type Props = {
  open: boolean;
  refreshToken: number;
  onClose: () => void;
  onOpenItem: (item: SavedTranscription) => void;
};

function formatSavedDate(value: string) {
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AccountPanel({ open, refreshToken, onClose, onOpenItem }: Props) {
  const { user, profile, updateName, signOut } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [items, setItems] = useState<SavedTranscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open || !user) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setMessage("");
      void listTranscriptions(user.id)
        .then((nextItems) => {
          if (active) setItems(nextItems);
        })
        .catch(() => {
          if (active) setMessage("לא הצלחנו לטעון את ההיסטוריה.");
        })
        .finally(() => {
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
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
            <button
              type="button"
              className="secondary-button"
              disabled={!name.trim() || name.trim() === profile?.full_name}
              onClick={() => {
                setMessage("");
                void updateName(name)
                  .then(() => setMessage("השם נשמר."))
                  .catch(() => setMessage("לא הצלחנו לשמור את השם."));
              }}
            ><Save size={16} /> שמור</button>
          </div>
        </label>

        <div className="history-heading"><History size={19} /><strong>היצירות האחרונות שלי</strong></div>
        <div className="history-list">
          {loading ? (
            <p className="empty-history">טוען את ההיסטוריה…</p>
          ) : items.length === 0 ? (
            <p className="empty-history">עדיין אין תוצאות שמורות. התוצאה הראשונה תישמר כאן אוטומטית.</p>
          ) : (
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
