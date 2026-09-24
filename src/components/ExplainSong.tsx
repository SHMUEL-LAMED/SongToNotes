import { Lightbulb, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AiError, transformText } from "../lib/aiApi";
import { langForModel } from "../lib/i18n";
import { renderMarkdown } from "../lib/markdown";

type Props = {
  /** What the model is told about the song: key, chords, lyrics — whatever the tool knows. */
  describe: () => string;
  /** Changes when the song does, so an old explanation is not shown for a new song. */
  songKey: string;
};

/**
 * "Explain this song": the chords and whatever else the tool knows go to the
 * site's language model, and a short lesson comes back — the key, the
 * progression in Roman numerals, what is unusual about it, and tips.
 */
export function ExplainSong({ describe, songKey }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [shownFor, setShownFor] = useState(songKey);

  // A different song clears the last explanation.
  if (shownFor !== songKey) {
    setShownFor(songKey);
    setText(null);
    setError(null);
  }

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const reply = await transformText("explain", describe().slice(0, 12_000), { language: langForModel(), signal: controller.signal });
      setText(reply.text.trim() || "לא התקבל הסבר. נסה שוב.");
    } catch (caught) {
      if (caught instanceof AiError && caught.code === "cancelled") return;
      setError(caught instanceof Error ? caught.message : "ההסבר נכשל. נסה שוב.");
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  };

  return (
    <div className="workspace-card explain-song">
      <div className="explain-head">
        <span className="explain-icon">
          <Lightbulb size={18} />
        </span>
        <div>
          <h2>תסביר לי את השיר</h2>
          <p>הסולם, המהלך, מה מיוחד בו וטיפים לנגינה, בשפה פשוטה. נשלח לשרת רק רצף האקורדים והמילים, לא השיר עצמו.</p>
        </div>
        <button type="button" className={text ? "secondary-button" : "primary-button compact"} onClick={run} disabled={busy}>
          {text ? <RotateCcw size={16} /> : <Sparkles size={16} />}
          {busy ? "חושב…" : text ? "הסבר מחדש" : "הסבר"}
        </button>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {text && (
        <div className="assistant-markdown explain-body" dir="auto" aria-live="polite" translate="no">
          {renderMarkdown(text)}
        </div>
      )}
    </div>
  );
}
