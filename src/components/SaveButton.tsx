import { BookmarkPlus, Check, LoaderCircle, TriangleAlert } from "lucide-react";
import type { SaveState } from "../lib/useSaveWork";

type Props = {
  state: SaveState;
  onSave: () => void;
  disabled?: boolean;
  label?: string;
  message?: string | null;
  compact?: boolean;
};

/**
 * "Save to my area", the same on every tool. The button carries its own
 * feedback — saving, saved, failed — so a tool only decides what to save and
 * where the button sits.
 */
export function SaveButton({
  state,
  onSave,
  disabled = false,
  label = "שמור באזור האישי",
  message,
  compact = false,
}: Props) {
  const busy = state === "saving";
  return (
    <div className={`save-work ${compact ? "is-compact" : ""}`}>
      <button
        type="button"
        className={`save-work-button is-${state}`}
        onClick={onSave}
        disabled={disabled || busy}
        aria-live="polite"
      >
        {state === "saving" ? (
          <LoaderCircle size={17} className="spin" />
        ) : state === "saved" ? (
          <Check size={17} />
        ) : state === "failed" ? (
          <TriangleAlert size={17} />
        ) : (
          <BookmarkPlus size={17} />
        )}
        <span>
          {state === "saving"
            ? "שומר…"
            : state === "saved"
              ? "נשמר"
              : state === "failed"
                ? "השמירה נכשלה"
                : label}
        </span>
      </button>
      {message && (
        <small className="save-work-note" role="status">
          {message}
        </small>
      )}
    </div>
  );
}
