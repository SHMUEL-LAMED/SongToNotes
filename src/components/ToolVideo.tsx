import { PlayCircle } from "lucide-react";
import type { ToolDefinition } from "../lib/tools";

/** Where a tool's how-to video is served from. */
function toolVideoUrl(id: string): string {
  return `${import.meta.env.BASE_URL}videos/${id}.mp4`;
}

/**
 * A short how-to video under the tool, for the tools that have one. Only its
 * first frames load with the page; the rest waits for the play button.
 */
export function ToolVideo({ tool }: { tool: ToolDefinition }) {
  if (!tool.video) return null;
  return (
    <section className="tool-video" aria-labelledby="tool-video-title">
      <h2 id="tool-video-title">
        <PlayCircle size={18} aria-hidden="true" /> איך משתמשים ב{tool.title}
      </h2>
      <video
        src={toolVideoUrl(tool.id)}
        controls
        playsInline
        preload="metadata"
        width={1280}
        height={720}
        aria-label={`סרטון הדרכה: איך משתמשים ב${tool.title}`}
      />
    </section>
  );
}
