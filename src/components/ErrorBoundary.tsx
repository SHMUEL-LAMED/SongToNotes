import { House, RefreshCw, TriangleAlert } from "lucide-react";
import { Component, type ReactNode } from "react";
import { trackError } from "../lib/analytics";
import { currentLang } from "../lib/i18n";
import { currentRoute } from "../lib/router";
import { isMissingPiece, reloadForNewBuild, reloadingForNewBuild } from "../lib/staleBuild";

type Props = {
  children: ReactNode;
  /** The page on screen: moving to another leaves a failure behind. */
  resetKey?: string;
  /** Back to all the tools, when that is somewhere else. */
  onHome?: () => void;
  /** Outside the shell: the failure takes the whole screen. */
  whole?: boolean;
};

type State = {
  failed: boolean;
  /** A piece of the site that did not arrive, rather than a fault in it. */
  missing: boolean;
  /** On its way to the new build. */
  updating: boolean;
  key: string | undefined;
};

/* Written in both languages, like the invitations: an English page reloads anyway. */
const WORDS = {
  he: {
    updatingTitle: "האתר התעדכן",
    updatingText: "טוען את הגרסה החדשה…",
    missingTitle: "העמוד לא נטען",
    missingText: "ייתכן שהחיבור נקטע, או שהאתר התעדכן בינתיים. רענון הדף יטען אותו מחדש.",
    crashTitle: "משהו השתבש בעמוד הזה",
    crashText: "שאר האתר ממשיך לעבוד — אפשר לרענן את הדף או לחזור לכל הכלים.",
    crashTextWhole: "רענון הדף בדרך כלל פותר את זה.",
    reload: "רענון הדף",
    home: "לכל הכלים",
  },
  en: {
    updatingTitle: "The site was updated",
    updatingText: "Loading the new version…",
    missingTitle: "This page did not load",
    missingText: "The connection may have dropped, or the site was updated in the meantime. Reloading the page loads it again.",
    crashTitle: "Something went wrong on this page",
    crashText: "The rest of the site still works — reload the page, or go back to all the tools.",
    crashTextWhole: "Reloading the page usually fixes it.",
    reload: "Reload the page",
    home: "All the tools",
  },
};

/**
 * Without this, one failure while rendering — most often a tool whose piece
 * of the build did not arrive — empties the whole page. With it, the page
 * says what happened and offers a way on; a missing piece reloads the site
 * by itself, since that is nearly always a deploy the tab has not seen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { failed: false, missing: false, updating: false, key: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const missing = isMissingPiece(error);
    return { failed: true, missing, updating: missing && reloadingForNewBuild() };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Another page: whatever failed on the last one stays there.
    if (props.resetKey === state.key) return null;
    return { key: props.resetKey, failed: false, missing: false, updating: false };
  }

  componentDidCatch(error: unknown) {
    const missing = isMissingPiece(error);
    trackError(currentRoute(), missing ? "chunk_load_failed" : "page_crashed");
    if (missing && !this.state.updating && reloadForNewBuild()) this.setState({ updating: true });
  }

  render() {
    const { failed, missing, updating } = this.state;
    if (!failed) return this.props.children;
    const { whole, onHome } = this.props;
    const words = currentLang() === "en" ? WORDS.en : WORDS.he;

    const card = (
      <div className="site-closed is-error" role={updating ? "status" : "alert"}>
        <span className="brand-mark">
          {updating ? <RefreshCw size={22} className="spin" /> : <TriangleAlert size={22} />}
        </span>
        <h1>{updating ? words.updatingTitle : missing ? words.missingTitle : words.crashTitle}</h1>
        <p>{updating ? words.updatingText : missing ? words.missingText : whole ? words.crashTextWhole : words.crashText}</p>
        {!updating && (
          <div className="tool-inline-actions">
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>
              <RefreshCw size={16} /> {words.reload}
            </button>
            {!whole && onHome && (
              <button type="button" className="secondary-button" onClick={onHome}>
                <House size={16} /> {words.home}
              </button>
            )}
          </div>
        )}
      </div>
    );
    return whole ? <main className="auth-screen">{card}</main> : card;
  }
}
