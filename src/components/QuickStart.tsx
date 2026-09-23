import { ArrowLeft, Clapperboard, FileAudio, RotateCcw, UploadCloud } from "lucide-react";
import { useState, type CSSProperties, type DragEvent } from "react";
import { handOffTo } from "../lib/handoff";
import { TOOLS } from "../lib/tools";
import { formatBytes, validateAudioFile } from "./AudioPicker";

const ACCEPT = "audio/*,video/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.opus,.webm,.mp4,.mov,.mkv,.aif,.aiff";

function isVideo(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name);
}

/**
 * The home page's front door: drop any song, recording or video and pick
 * what to do with it. The file is handed to the chosen tool through the
 * same hand-off the tools use among themselves; it waits on the device
 * until a tool is chosen.
 */
export function QuickStart({ disabledTools = [] }: { disabledTools?: string[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const choose = (candidate?: File | null) => {
    if (!candidate) return;
    const limit = 800 * 1024 * 1024;
    // Empty and oversized files are refused whatever they are; only the
    // audio-type check is waived for a video.
    const problem =
      candidate.size === 0
        ? "הקובץ ריק."
        : candidate.size > limit
          ? `הקובץ גדול מ־${formatBytes(limit)}.`
          : isVideo(candidate)
            ? null
            : validateAudioFile(candidate, limit);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setFile(candidate);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files?.[0]);
  };

  const send = (tool: string) => {
    if (!file || sending) return;
    setSending(tool);
    void handOffTo(tool, file, file.name).catch(() => {
      setSending(null);
      setError("לא הצלחנו להעביר את הקובץ. נסו לפתוח את הכלי ולבחור אותו שם.");
    });
  };

  const video = file ? isVideo(file) : false;
  const actions = [
    ...(video ? [{ id: "video", title: "וידאו לאודיו", quick: "חילוץ הצליל", icon: Clapperboard, hue: 40 }] : []),
    ...TOOLS.filter((tool) => tool.quick).map((tool) => ({ id: tool.id, title: tool.title, quick: tool.quick!, icon: tool.icon, hue: tool.hue })),
  ].filter((action) => !disabledTools.includes(action.id));

  if (file) {
    return (
      <div className="quick-start is-chosen">
        <div className="quick-file">
          <span className="quick-file-icon">{video ? <Clapperboard size={20} /> : <FileAudio size={20} />}</span>
          <div>
            <strong>{file.name}</strong>
            <small>
              {formatBytes(file.size)} · {video ? "סרטון" : "קובץ שמע"} · מחכה במכשיר עד שתבחרו
            </small>
          </div>
          <button type="button" className="icon-button" onClick={() => setFile(null)} aria-label="בחירת קובץ אחר" title="קובץ אחר">
            <RotateCcw size={16} />
          </button>
        </div>
        <p className="quick-question">מה לעשות עם הקובץ?</p>
        <div className="quick-actions">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                className={`quick-action ${sending === action.id ? "is-sending" : ""}`}
                style={{ "--accent-hue": action.hue } as CSSProperties}
                onClick={() => send(action.id)}
                disabled={Boolean(sending)}
              >
                <span className="quick-action-icon">
                  <Icon size={17} />
                </span>
                <span className="quick-action-text">
                  <b>{action.quick}</b>
                  <small>{action.title}</small>
                </span>
                <ArrowLeft size={15} className="quick-action-go" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="quick-start">
      <label
        className={`quick-drop ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="quick-drop-icon">
          <UploadCloud size={26} />
        </span>
        <strong>גררו לכאן שיר, הקלטה או סרטון</strong>
        <span>או לחצו לבחירת קובץ — ונציע מה אפשר לעשות איתו</span>
        <span className="quick-formats" aria-hidden="true">
          {["MP3", "WAV", "M4A", "FLAC", "MP4", "MOV"].map((format) => (
            <i key={format}>{format}</i>
          ))}
        </span>
        <input
          className="native-file-input"
          type="file"
          accept={ACCEPT}
          aria-label="בחירת קובץ שמע או וידאו"
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
  );
}
