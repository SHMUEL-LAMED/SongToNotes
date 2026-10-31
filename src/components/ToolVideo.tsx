import { Play, PlayCircle } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import type { ToolDefinition } from "../lib/tools";

/** Where a tool's how-to video, and the still shown before it plays, are served from. */
function toolVideoUrl(id: string, extension: "mp4" | "webp"): string {
  return `${import.meta.env.BASE_URL}videos/${id}.${extension}`;
}

/**
 * A short how-to video at the foot of the tool, for the tools that have one.
 * It shows a still from the video with a large play button, and nothing of
 * the video itself downloads until the button is pressed; then it plays in
 * place, the panel's full width, with the browser's own controls.
 */
export function ToolVideo({ tool }: { tool: ToolDefinition }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  if (!tool.video) return null;

  const start = () => {
    setStarted(true);
    void videoRef.current?.play().catch(() => undefined);
  };

  return (
    <section className="panel tool-video" aria-labelledby="tool-video-title" style={{ "--accent-hue": tool.hue } as CSSProperties}>
      <header className="panel-head tool-video-head">
        <span className="panel-num" aria-hidden="true" />
        <span className="panel-icon tool-video-icon" aria-hidden="true">
          <PlayCircle size={16} />
        </span>
        <div className="panel-heading">
          <h2 className="panel-title" id="tool-video-title">
            איך זה עובד
          </h2>
          <p className="panel-hint">
            איך משתמשים ב<b className="tool-video-name">{tool.title}</b> — מדריך קצר בווידאו, פחות מדקה
          </p>
        </div>
      </header>
      <figure className={`tool-video-frame${started ? " is-started" : ""}`}>
        <video
          ref={videoRef}
          src={toolVideoUrl(tool.id, "mp4")}
          poster={toolVideoUrl(tool.id, "webp")}
          controls={started}
          playsInline
          preload="none"
          width={1280}
          height={720}
          aria-label={`סרטון הדרכה: איך משתמשים ב${tool.title}`}
        />
        {!started && (
          <button type="button" className="tool-video-play" onClick={start} aria-label={`הפעלת הסרטון: איך משתמשים ב${tool.title}`}>
            <span className="tool-video-play-mark">
              <Play size={26} fill="currentColor" aria-hidden="true" />
            </span>
          </button>
        )}
      </figure>
    </section>
  );
}
