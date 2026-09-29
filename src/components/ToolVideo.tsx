import { Play, PlayCircle } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import type { ToolDefinition } from "../lib/tools";

/** Where a tool's how-to video, and the still shown before it plays, are served from. */
function toolVideoUrl(id: string, extension: "mp4" | "webp"): string {
  return `${import.meta.env.BASE_URL}videos/${id}.${extension}`;
}

/**
 * A short how-to video under the tool, for the tools that have one. It shows
 * a still from the video with a large play button, and nothing of the video
 * itself downloads until the button is pressed; then it plays in place, the
 * column's full width, with the browser's own controls.
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
    <section
      className="tool-video"
      aria-labelledby="tool-video-title"
      style={{ "--accent-hue": tool.hue } as CSSProperties}
    >
      <div className="tool-video-head">
        <span className="tool-video-icon">
          <PlayCircle size={18} aria-hidden="true" />
        </span>
        <span>
          <h2 id="tool-video-title">איך משתמשים ב{tool.title}</h2>
          <small>מדריך קצר בווידאו, פחות מדקה</small>
        </span>
      </div>
      <div className={`tool-video-frame${started ? " is-started" : ""}`}>
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
              <Play size={30} fill="currentColor" aria-hidden="true" />
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
