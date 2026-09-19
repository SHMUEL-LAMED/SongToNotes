import { useEffect, useRef } from "react";
import { registerAssistantBinding, type ActionHandler } from "./assistantActions";

type Binding = {
  /** A few lines about what is on screen, for the model. */
  state?: () => string | null | undefined;
  handlers: Partial<Record<string, ActionHandler>>;
};

/**
 * Lends a page's hands to the assistant for as long as the page is mounted.
 * The handlers close over the page's state, so they are handed over fresh
 * after every render; the registration itself happens once.
 */
export function useAssistantTool(tool: string, binding: Binding) {
  const ref = useRef(binding);
  useEffect(() => {
    ref.current = binding;
  });
  useEffect(
    () =>
      registerAssistantBinding({
        tool,
        get handlers() {
          return ref.current.handlers;
        },
        get state() {
          return ref.current.state;
        },
      }),
    [tool],
  );
}
