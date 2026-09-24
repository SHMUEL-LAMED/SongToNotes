import { CloudOff, RefreshCw, X } from "lucide-react";
import { useEffect, useState, type PropsWithChildren } from "react";
import { useOnline, useServiceWorker } from "../lib/pwa";

/**
 * Two quiet, transient messages that belong to the app itself rather than to
 * any one tool: "you are offline, and here is what that means" and "a newer
 * version is ready". Both sit out of the way at the bottom of the screen, and
 * whatever else the app floats there (the request to share the site) stacks
 * with them rather than on top of them.
 */
export function AppNotices({ children }: PropsWithChildren) {
  const { updateReady, applyUpdate } = useServiceWorker();
  const online = useOnline();
  const [offlineDismissed, setOfflineDismissed] = useState(false);

  // Coming back online resets the notice, so the next drop is announced again.
  useEffect(() => {
    const reset = () => setOfflineDismissed(false);
    window.addEventListener("online", reset);
    return () => window.removeEventListener("online", reset);
  }, []);

  const showOffline = !online && !offlineDismissed;
  if (!showOffline && !updateReady && !children) return null;

  return (
    <div className="app-notices">
      {showOffline && (
        <div className="app-notice" role="status">
          <span className="app-notice-icon">
            <CloudOff size={17} />
          </span>
          <p>
            <strong>אין חיבור לאינטרנט.</strong> כל הכלים ממשיכים לעבוד — רק
            ההתחברות ושמירת ההיסטוריה ימתינו לחיבור.
          </p>
          <button
            type="button"
            className="app-notice-close"
            onClick={() => setOfflineDismissed(true)}
            aria-label="סגירת ההודעה"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {updateReady && (
        <div className="app-notice app-notice-update" role="status">
          <span className="app-notice-icon">
            <RefreshCw size={17} />
          </span>
          <p>
            <strong>יש גרסה חדשה.</strong> רענן כדי לעדכן.
          </p>
          <button type="button" className="app-notice-action" onClick={applyUpdate}>
            רענן עכשיו
          </button>
        </div>
      )}

      {children}
    </div>
  );
}
