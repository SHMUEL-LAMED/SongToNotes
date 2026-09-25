/**
 * WAV encoding for every tool that hands the visitor a file back. Encoding
 * happens here rather than through MediaRecorder so the export is
 * deterministic, lossless and works the same in every browser — and, like the
 * rest of the site, without the audio ever leaving the machine.
 */

export type PcmSource = {
  channels: Float32Array[];
  sampleRate: number;
};

export function fromAudioBuffer(buffer: AudioBuffer): PcmSource {
  return {
    channels: Array.from({ length: buffer.numberOfChannels }, (_, index) =>
      buffer.getChannelData(index).slice(),
    ),
    sampleRate: buffer.sampleRate,
  };
}

/** 16-bit PCM keeps the file half the size of float32 and opens everywhere. */
export function encodeWav({ channels, sampleRate }: PcmSource): Blob {
  const channelCount = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = channels[channel]?.[frame] ?? 0;
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      view.setInt16(offset, Math.round(clamped * 32767), true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * The channels of a 16-bit PCM WAV — the server's voice answers in one — or
 * null for any other file, which the browser's own decoder can still try.
 */
export function decodeWav(bytes: ArrayBuffer): PcmSource | null {
  const view = new DataView(bytes);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
  if (bytes.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let format: { channels: number; sampleRate: number } | null = null;
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (tag(offset) === "fmt " && size >= 16) {
      const code = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      if ((code !== 1 && code !== 0xfffe) || view.getUint16(body + 14, true) !== 16 || !channels) return null;
      format = { channels, sampleRate: view.getUint32(body + 4, true) };
    } else if (tag(offset) === "data") {
      if (!format) return null;
      // A WAV written as it streams claims more than it holds.
      const frames = Math.floor((Math.min(bytes.byteLength, body + size) - body) / (2 * format.channels));
      const channels = Array.from({ length: format.channels }, () => new Float32Array(frames));
      for (let frame = 0; frame < frames; frame += 1) {
        for (let channel = 0; channel < format.channels; channel += 1) {
          channels[channel][frame] = view.getInt16(body + (frame * format.channels + channel) * 2, true) / 32768;
        }
      }
      return { channels, sampleRate: format.sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** Renders an offline graph back into plain channel data. */
export async function renderOffline(
  buffer: AudioBuffer,
  build: (context: OfflineAudioContext, source: AudioBufferSourceNode) => void,
  options: { duration?: number; sampleRate?: number } = {},
): Promise<AudioBuffer> {
  const OfflineContext =
    window.OfflineAudioContext ||
    (window as typeof window & {
      webkitOfflineAudioContext?: typeof OfflineAudioContext;
    }).webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");

  const sampleRate = options.sampleRate ?? buffer.sampleRate;
  const duration = options.duration ?? buffer.duration;
  const context = new OfflineContext(
    buffer.numberOfChannels,
    Math.max(1, Math.ceil(duration * sampleRate)),
    sampleRate,
  );
  const source = context.createBufferSource();
  source.buffer = buffer;
  build(context, source);
  return context.startRendering();
}
