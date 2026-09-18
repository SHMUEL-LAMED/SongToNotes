import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import { saveWork, type NewWork, type SavedWork } from "./works";

export type SaveState = "idle" | "saving" | "saved" | "failed";

/** How long "נשמר" stays on the button before it offers to save again. */
const SAVED_FOR = 3200;

/**
 * The save button's state machine, shared by every tool: one call writes the
 * work (and its file, if any) to this device and to the profile, and the
 * button reports what happened in the visitor's own terms — including that a
 * save without an account went to this device only.
 */
export function useSaveWork() {
  const { user } = useAuth();
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [last, setLast] = useState<SavedWork | null>(null);
  const timerRef = useRef(0);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const reset = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setState("idle");
    setMessage(null);
  }, []);

  const save = useCallback(
    async (input: NewWork, file?: File | Blob | null) => {
      window.clearTimeout(timerRef.current);
      setState("saving");
      setMessage(null);
      try {
        const saved = await saveWork(input, user?.id ?? null, file);
        setLast(saved);
        setState("saved");
        setMessage(
          !user
            ? file
              ? "נשמר במכשיר הזה. התחבר כדי שהקובץ יעלה לענן ויהיה בכל מכשיר."
              : "נשמר במכשיר הזה. התחבר כדי לראות את זה בכל מכשיר."
            : saved.localOnly
              ? "נשמר במכשיר; יעלה לפרופיל כשיהיה חיבור."
              : saved.summary.fileTooLarge
                ? "נשמר באזור האישי, אבל הקובץ גדול מ־60MB ונשאר במכשיר הזה בלבד."
                : file && !saved.filePath
                  ? "נשמר באזור האישי; הקובץ יעלה לענן כשיהיה חיבור."
                  : file
                    ? "נשמר באזור האישי והקובץ עלה לענן — זמין מכל מכשיר."
                    : "נשמר באזור האישי שלך.",
        );
        timerRef.current = window.setTimeout(() => setState("idle"), SAVED_FOR);
        return saved;
      } catch {
        setState("failed");
        setMessage("לא הצלחנו לשמור. נסה שוב.");
        return null;
      }
    },
    [user],
  );

  return { save, state, message, last, reset, signedIn: Boolean(user) };
}
