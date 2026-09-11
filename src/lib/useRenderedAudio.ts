import { useEffect, useRef, useState } from "react";

/**
 * Runs an expensive buffer transform off the render path and keys the result
 * to the inputs that produced it. `busy` is derived from that key rather than
 * set separately, so there is never a frame where the two disagree — and a
 * dial that moves three times only leaves the last render standing.
 */
export function useRenderedAudio(
  key: string,
  compute: () => AudioBuffer | null,
  delayMs = 80,
) {
  const [result, setResult] = useState<{ key: string; buffer: AudioBuffer | null }>({
    key: "",
    buffer: null,
  });
  const computeRef = useRef(compute);
  // Declared before the effect below so the timer it schedules always reads
  // the transform that belongs to the render that scheduled it.
  useEffect(() => {
    computeRef.current = compute;
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    // The gap both debounces a dragged slider and lets the pending state
    // paint before a long synchronous transform blocks the thread.
    const timer = window.setTimeout(() => {
      const buffer = computeRef.current();
      if (!cancelled) setResult({ key, buffer });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [delayMs, key]);

  const matches = result.key === key;
  return {
    buffer: matches ? result.buffer : null,
    busy: Boolean(key) && !matches,
  };
}
