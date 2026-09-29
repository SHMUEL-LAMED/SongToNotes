/// <reference lib="webworker" />
/**
 * The voice changer's array stage, off the page. The pitch shift and the
 * whisper vocoder walk every sample many times over — on a few minutes of
 * audio that is seconds of solid work, which would freeze the page if it ran
 * there. One channel per worker, so a stereo file uses two cores.
 */
import { preprocessChannel, type VoiceFxRequest, type VoiceFxResponse } from "../lib/voiceFx";

self.onmessage = (event: MessageEvent<VoiceFxRequest>) => {
  const { id, intensity, channel, sampleRate, index } = event.data;
  try {
    const output = preprocessChannel(id, intensity, channel, sampleRate, index);
    const done: VoiceFxResponse = { ok: true, channel: output };
    self.postMessage(done, [output.buffer]);
  } catch (caught) {
    const failed: VoiceFxResponse = { ok: false, message: caught instanceof Error ? caught.message : "העיבוד נכשל." };
    self.postMessage(failed);
  }
};
