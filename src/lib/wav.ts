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
