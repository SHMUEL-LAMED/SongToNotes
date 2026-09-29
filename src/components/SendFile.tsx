import { ArrowLeft, ChevronDown, FileAudio, Forward, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { receivingTools, sendOffer, useFileOffer, type FileOffer } from "../lib/currentFile";
import { currentRoute } from "../lib/router";
import "../styles/send-file.css";

const FAILED = "לא הצלחנו להעביר את הקובץ. אפשר להוריד אותו ולבחור אותו בכלי הבא.";

/** Sends an offer on, remembering which tool it is on its way to. */
function useSender() {
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = (offer: FileOffer, tool: string) => {
    if (sending) return;
    setSending(tool);
    setError(null);
    void sendOffer(offer, tool)
      .catch(() => setError(FAILED))
      .finally(() => setSending(null));
  };
  return { sending, error, send };
}

/**
 * "Carry on with this file" at the foot of a tool: every tool that can open
 * it, one tap each, and the file travels on the device — nothing is uploaded
 * again. Shows the tool's result when it has one, the song otherwise.
 */
export function SendFileSection({ disabledTools = [] }: { disabledTools?: readonly string[] }) {
  const offer = useFileOffer();
  const { sending, error, send } = useSender();
  if (!offer) return null;
  const targets = receivingTools(offer.tool, disabledTools);
  if (!targets.length) return null;
  const isResult = offer.kind === "result";

  return (
    <section className="send-file" aria-labelledby="send-file-title">
      <div className="send-file-head">
        <span className="send-file-icon" aria-hidden="true">
          {isResult ? <Sparkles size={18} /> : <FileAudio size={18} />}
        </span>
        <div>
          <h2 id="send-file-title">ממשיכים עם {isResult ? "התוצאה" : "הקובץ"}</h2>
          <p>
            <bdi className="send-file-name">{offer.name}</bdi> עובר לכלי הבא כמו שהוא, בלי להעלות אותו שוב.
          </p>
        </div>
      </div>
      <div className="send-file-grid">
        {targets.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              className={`send-file-target ${sending === tool.id ? "is-sending" : ""}`}
              style={{ "--accent-hue": tool.hue } as CSSProperties}
              onClick={() => send(offer, tool.id)}
              disabled={Boolean(sending)}
            >
              <span className="send-file-target-icon">
                {sending === tool.id ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}
              </span>
              <span className="send-file-target-text">
                <b>{tool.quick}</b>
                <small>{tool.title}</small>
              </span>
              <ArrowLeft size={14} className="send-file-go" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * The same choice in a small menu beside a loaded file, for someone who knows
 * straight away that the song belongs in another tool.
 */
export function SendFileMenu({ file }: { file: File }) {
  const [open, setOpen] = useState(false);
  const { sending, error, send } = useSender();
  const rootRef = useRef<HTMLDivElement>(null);
  const tool = currentRoute();
  const targets = receivingTools(tool);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      rootRef.current?.querySelector<HTMLElement>(".send-file-toggle")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!targets.length) return null;
  const offer: FileOffer = { kind: "source", name: file.name, tool, get: () => file };

  return (
    <div className="send-file-menu" ref={rootRef}>
      <button
        type="button"
        className="secondary-button compact send-file-toggle"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
        title="לפתוח את הקובץ הזה בכלי אחר"
      >
        <Forward size={16} /> לכלי אחר <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="send-file-popover" role="menu" aria-label="לפתוח את הקובץ בכלי">
          {targets.map((target) => {
            const Icon = target.icon;
            return (
              <button
                key={target.id}
                type="button"
                role="menuitem"
                className="send-file-item"
                style={{ "--accent-hue": target.hue } as CSSProperties}
                onClick={() => send(offer, target.id)}
                disabled={Boolean(sending)}
              >
                {sending === target.id ? <Loader2 size={15} className="spin" /> : <Icon size={15} />}
                <span>{target.quick}</span>
              </button>
            );
          })}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
