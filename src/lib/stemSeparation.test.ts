import { describe, expect, it, vi } from "vitest";
import { SeparationError, separateStems } from "./stemSeparation";

describe("separateStems", () => {
  it("does not touch the model for a run cancelled before it began", async () => {
    const controller = new AbortController();
    controller.abort();
    const progress = vi.fn();
    const buffer = { duration: 1, numberOfChannels: 2 } as unknown as AudioBuffer;
    await expect(separateStems(buffer, progress, 2, controller.signal)).rejects.toBeInstanceOf(SeparationError);
    // Only the opening "preparing" line: no download, no engine.
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls[0][0].phase).toBe("model");
  });

  it("lets the next run start after a cancelled one", async () => {
    const first = new AbortController();
    first.abort();
    const second = new AbortController();
    second.abort();
    const buffer = { duration: 1, numberOfChannels: 2 } as unknown as AudioBuffer;
    const runs = [
      separateStems(buffer, () => {}, 2, first.signal),
      separateStems(buffer, () => {}, 2, second.signal),
    ];
    const settled = await Promise.allSettled(runs);
    expect(settled.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  });
});
