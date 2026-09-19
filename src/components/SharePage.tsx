import { Download, Eye, Link2, Music2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { formatTime } from "../lib/audio";
import { renderMarkdown } from "../lib/markdown";
import { fetchShare, type SharedWork } from "../lib/share";
import { segmentsToText } from "../lib/transcript";
import { normalizeSegments } from "../lib/transcript";
import { findTool } from "../lib/tools";
import { KIND_LABELS, KIND_TOOL, describeWork, isWorkKind } from "../lib/works";

type Props = { token: string; onHome: () => void };

/**
 * The page behind a share link: one work, for anyone. A player and a
 * download when there is a file, the text when the work is text (a
 * transcript, lyrics, a song sheet, chords), and a way into the site.
 */
export function SharePage({ token, onHome }: Props) {
  // Keyed by token, so a new link starts from nothing without a reset in the effect.
  const [state, setState] = useState<{ token: string; work: SharedWork | null; error: string | null }>({ token, work: null, error: null });
  const work = state.token === token ? state.work : null;
  const error = state.token === token ? state.error : null;

  useEffect(() => {
    let cancelled = false;
    fetchShare(token)
      .then((found) => {
        if (!cancelled) setState({ token, work: found, error: null });
      })
      .catch((caught: Error) => {
        if (!cancelled) setState({ token, work: null, error: caught.message });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const kind = work && isWorkKind(work.kind) ? work.kind : null;
  const tool = kind ? findTool(KIND_TOOL[kind]) : null;
  const Icon = tool?.icon ?? Music2;
  const text = work
    ? kind === "transcript"
      ? segmentsToText(normalizeSegments(work.payload.segments))
      : kind === "lyrics" && Array.isArray(work.payload.lines)
        ? (work.payload.lines as { text?: string }[]).map((line) => line.text ?? "").join("\n")
        : kind === "song" && typeof work.payload.body === "string"
          ? work.payload.body.replace(/\[([^\]]+)\]/g, "[$1] ")
          : kind === "chords" && Array.isArray(work.payload.segments)
            ? (work.payload.segments as { start?: number; root?: number; quality?: string }[])
                .map((segment) => `${formatTime(Number(segment.start) || 0)}  ${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][Number(segment.root) || 0]}${segment.quality ?? ""}`)
                .join("\n")
            : null
    : null;

  return (
    <section className="tool-body share-page">
      {error && (
        <div className="workspace-card">
          <div className="error-message" role="alert">
            {error}
          </div>
          <button type="button" className="primary-button compact" onClick={onHome}>
            <Sparkles size={16} /> לכלי המוזיקה
          </button>
        </div>
      )}
      {!work && !error && (
        <div className="tool-loading" role="status">
          <span className="brand-mark">
            <Music2 size={20} />
          </span>
          טוען את השיתוף…
        </div>
      )}
      {work && (
        <div className="workspace-card">
          <div className="tool-intro">
            <span className="tool-intro-icon" style={tool ? ({ "--accent-hue": tool.hue } as React.CSSProperties) : undefined}>
              <Icon size={26} />
            </span>
            <div>
              <span className="eyebrow-small">
                <Link2 size={14} /> שותף מ{tool ? `כלי ${tool.title}` : "כלי מוזיקה"}
              </span>
              <h1 dir="auto">{work.title}</h1>
              <p>
                {kind ? KIND_LABELS[kind] : ""}
                {kind ? ` · ${describeWork({ id: "", kind, title: work.title, sourceName: null, summary: work.summary, payload: work.payload, fileName: work.fileName, deviceId: null, filePath: null, createdAt: work.createdAt, updatedAt: work.createdAt, origin: "works", rowId: null, localOnly: false })}` : ""}
              </p>
            </div>
          </div>

          {work.fileUrl && (
            <>
              <audio controls src={work.fileUrl} className="convert-preview" aria-label="נגן" />
              <div className="download-buttons">
                <a className="share-download" href={work.fileUrl} download={work.fileName ?? undefined}>
                  <Download size={17} /> הורד {work.fileName ? `(${work.fileName})` : ""}
                </a>
              </div>
            </>
          )}
          {text && (
            <div className="share-text" dir="auto">
              {kind === "song" ? renderMarkdown(text) : text.split("\n").map((line, index) => <p key={index}>{line}</p>)}
            </div>
          )}
          {!work.fileUrl && !text && <p className="table-footnote">העבודה הזאת נשמרה בלי קובץ. אפשר לפתוח אותה באתר ולהפיק מחדש.</p>}

          <p className="table-footnote share-meta">
            <Eye size={13} /> {work.views} צפיות · נוצר ב־{new Date(work.createdAt).toLocaleDateString("he-IL")}
          </p>
          <button type="button" className="primary-button compact" onClick={onHome}>
            <Sparkles size={16} /> ליצור בעצמך — כלי מוזיקה, חינם בדפדפן
          </button>
        </div>
      )}
    </section>
  );
}
