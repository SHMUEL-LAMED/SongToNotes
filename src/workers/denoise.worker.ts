/// <reference lib="webworker" />
/**
 * Noise reduction, off the page. A few minutes of stereo audio is tens of
 * thousands of FFT frames per channel — seconds of solid work that would
 * freeze scrolling and the progress bar if it ran in the click handler.
 */
import { denoiseChannels, type DenoiseRequest, type DenoiseResponse } from "../lib/denoise";

self.onmessage = (event: MessageEvent<DenoiseRequest>) => {
  const { jobId, channels, sampleRate, settings, source } = event.data;
  try {
    let lastSent = -1;
    const result = denoiseChannels(channels, sampleRate, settings, source, (fraction) => {
      // Posting on every callback would flood the page; whole percents are plenty.
      const percent = Math.floor(fraction * 100);
      if (percent === lastSent) return;
      lastSent = percent;
      const progress: DenoiseResponse = { type: "progress", jobId, fraction };
      self.postMessage(progress);
    });
    const done: DenoiseResponse = { type: "done", jobId, result };
    self.postMessage(
      done,
      result.channels.map((channel) => channel.buffer as ArrayBuffer),
    );
  } catch (caught) {
    const failed: DenoiseResponse = {
      type: "error",
      jobId,
      message: caught instanceof Error ? caught.message : "הניקוי נכשל.",
    };
    self.postMessage(failed);
  }
};
