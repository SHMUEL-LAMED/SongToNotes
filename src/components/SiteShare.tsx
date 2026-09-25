import { Check, Copy, Heart, Mail, Share2, X, Zap } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { referralLink } from "../lib/credits";
import { useCredits } from "../lib/creditsContext";
import {
  canShareNatively,
  inviteMessage,
  markShared,
  shareMessage,
  shareNatively,
  shareTargets,
  siteUrl,
  type ShareTargetId,
} from "../lib/siteShare";

/** The apps' own marks (Simple Icons, CC0), drawn in currentColor. */
const MARKS: Partial<Record<ShareTargetId, string>> = {
  whatsapp:
    "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  telegram:
    "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  facebook:
    "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  x: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z",
};

/** Each app's colour behind its mark, and the colour of the mark on it. */
const BRANDS: Record<ShareTargetId, { brand: string; ink: string }> = {
  whatsapp: { brand: "#25d366", ink: "#ffffff" },
  telegram: { brand: "#26a5e4", ink: "#ffffff" },
  facebook: { brand: "#0866ff", ink: "#ffffff" },
  x: { brand: "var(--text)", ink: "var(--bg)" },
  email: { brand: "var(--accent)", ink: "var(--on-accent)" },
};

function TargetIcon({ id, size = 18 }: { id: ShareTargetId; size?: number }) {
  const path = MARKS[id];
  if (!path) return <Mail size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** The address to pass on, and the words with it: the account's private link when there is one. */
function useShareLink() {
  const { status, rules } = useCredits();
  const personal = Boolean(status?.code) && rules.enabled;
  const url = personal && status ? referralLink(status.code) : siteUrl();
  const { title, text } = personal ? inviteMessage(rules.welcomeBonus) : shareMessage();
  return { url, title, text, personal };
}

/**
 * One tap to each app people pass links around in, and the system's own
 * share sheet where there is one. Used by the share window and by the
 * credits page, for the private link.
 */
export function ShareTargetButtons({
  url,
  text,
  title,
  onShared,
}: {
  url: string;
  text: string;
  title: string;
  onShared?: () => void;
}) {
  const targets = shareTargets(url, text, title);
  const shareElsewhere = () => {
    void shareNatively(url, text, title).then((outcome) => {
      if (outcome !== "shared") return;
      markShared();
      onShared?.();
    });
  };
  return (
    <div className="share-site-targets">
      {targets.map((target) => (
        <a
          key={target.id}
          className="share-site-target"
          href={target.href}
          // A mail link opens the mail app, not a page, so it needs no tab of its own.
          target={target.id === "email" ? undefined : "_blank"}
          rel="noopener noreferrer"
          style={{ "--share-brand": BRANDS[target.id].brand, "--share-ink": BRANDS[target.id].ink } as CSSProperties}
          onClick={() => markShared()}
        >
          <span className="share-site-mark">
            <TargetIcon id={target.id} />
          </span>
          {target.label}
        </a>
      ))}
      {canShareNatively() && (
        <button type="button" className="share-site-target" onClick={shareElsewhere}>
          <span className="share-site-mark">
            <Share2 size={18} />
          </span>
          עוד…
        </button>
      )}
    </div>
  );
}

/**
 * The share window the top bar opens: the site's address, ready to copy, and
 * one tap to the apps people pass links around in. Where the system has a
 * share sheet of its own, it is one more button away. A signed-in visitor
 * shares their private link, which earns them credits.
 */
export function ShareSiteDialog({
  open,
  onClose,
  onOpenCredits,
}: {
  open: boolean;
  onClose: () => void;
  /** Opens the page that explains the credits a private link earns. */
  onOpenCredits?: () => void;
}) {
  if (!open) return null;
  // Mounted afresh for every opening, so "copied" never greets the next one.
  return <ShareSheet onClose={onClose} onOpenCredits={onOpenCredits} />;
}

function ShareSheet({ onClose, onOpenCredits }: { onClose: () => void; onOpenCredits?: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const { rules } = useCredits();
  const { url, title, text, personal } = useShareLink();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  // "Copied" turns back into the button's own label after a moment.
  useEffect(() => {
    if (copy !== "copied") return;
    const timer = window.setTimeout(() => setCopy("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [copy]);

  const copyLink = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(url);
        markShared();
        setCopy("copied");
      } catch {
        // No clipboard here (an older browser, a page not served over https):
        // the address is selected instead, for the visitor to copy.
        linkRef.current?.select();
        setCopy("failed");
      }
    })();
  };

  return (
    <div className="dialog-overlay" role="presentation" onMouseDown={onClose}>
      <div className="dialog share-site-dialog" role="dialog" aria-modal="true" aria-labelledby="share-site-title" onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeRef} type="button" className="icon-button dialog-close" onClick={onClose} aria-label="סגירה">
          <X size={17} />
        </button>
        <h2 id="share-site-title">שיתוף האתר</h2>
        <p>כל הכלים כאן חינמיים ורצים בדפדפן. שלחו את הקישור למי שמנגן, שר או מלמד מוזיקה.</p>
        {personal ? (
          <p className="share-site-credits">
            <Zap size={15} aria-hidden="true" />
            <span>
              {`זה הקישור האישי שלך: על כל חבר שמצטרף דרכו תקבל ${rules.signupBonus} קרדיטים, והקצבה היומית שלך תגדל.`}{" "}
              {onOpenCredits && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    onClose();
                    onOpenCredits();
                  }}
                >
                  איך זה עובד
                </button>
              )}
            </span>
          </p>
        ) : rules.enabled && onOpenCredits ? (
          <p className="share-site-credits">
            <Zap size={15} aria-hidden="true" />
            <span>
              מתחברים ומקבלים קישור אישי — וכל חבר שמצטרף דרכו מזכה בקרדיטים.{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  onClose();
                  onOpenCredits();
                }}
              >
                איך זה עובד
              </button>
            </span>
          </p>
        ) : null}

        <ShareTargetButtons url={url} text={text} title={title} onShared={onClose} />

        <div className="share-site-link">
          <input
            ref={linkRef}
            className="field"
            type="text"
            readOnly
            value={url}
            dir="ltr"
            aria-label="הקישור לאתר"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="button" className={`secondary-button compact ${copy === "copied" ? "is-on" : ""}`} onClick={copyLink}>
            {copy === "copied" ? <Check size={16} /> : <Copy size={16} />}
            {copy === "copied" ? "הועתק" : "העתקה"}
          </button>
        </div>
        {copy === "failed" && (
          <p className="share-site-note" role="status">
            ההעתקה האוטומטית לא עבדה כאן — הקישור מסומן, אפשר להעתיק אותו ידנית.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The request that rises after every ten minutes on screen: a line of thanks
 * and the two shortest ways to pass the site on. It never takes the focus or
 * dims the page, so whoever is mid-song keeps playing.
 */
export function SharePrompt({ onMore, onClose }: { onMore: () => void; onClose: () => void }) {
  const { url, title, text, personal } = useShareLink();
  const { rules } = useCredits();
  const whatsapp = shareTargets(url, text, title).find((target) => target.id === "whatsapp")!;

  return (
    <div
      className="app-notice share-prompt"
      role="status"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <span className="app-notice-icon share-prompt-icon">
        <Heart size={17} />
      </span>
      <p>
        <strong>נהנים מהאתר?</strong>{" "}
        {personal
          ? `ספרו עליו לחברים דרך הקישור האישי שלכם — על כל חבר שמצטרף תקבלו ${rules.signupBonus} קרדיטים.`
          : "ספרו עליו לחברים — הוא חינמי, וכל שיתוף עוזר לו להמשיך ולגדול."}
      </p>
      <div className="share-prompt-actions">
        <a
          className="share-prompt-whatsapp"
          href={whatsapp.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            markShared();
            onClose();
          }}
        >
          <TargetIcon id="whatsapp" size={16} /> שליחה בוואטסאפ
        </a>
        <button type="button" className="share-prompt-more" onClick={onMore}>
          <Share2 size={15} /> דרכים נוספות
        </button>
      </div>
      <button type="button" className="app-notice-close" onClick={onClose} aria-label="לא עכשיו" title="לא עכשיו">
        <X size={15} />
      </button>
    </div>
  );
}
