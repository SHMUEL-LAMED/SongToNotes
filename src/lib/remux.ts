import type { RecordingType } from "./visualizer";

/**
 * MediaRecorder writes a streaming file: a fragmented MP4 (or a WebM) with no
 * duration and no seek index. Browsers cope, but desktop players such as the
 * Windows media player show a stuck seek bar or refuse to play it. Copying the
 * streams into a regular container — no re-encoding — gives a file with a
 * real duration and its index up front. Any failure keeps the original file.
 */
export async function finalizeRecording(blob: Blob, type: RecordingType): Promise<Blob> {
  try {
    const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, Conversion } =
      await import("mediabunny");
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const target = new BufferTarget();
    const output = new Output({
      format: type.extension === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
      target,
    });
    const conversion = await Conversion.init({ input, output });
    if (!conversion.isValid) return blob;
    await conversion.execute();
    if (!target.buffer || target.buffer.byteLength < 1024) return blob;
    return new Blob([target.buffer], { type: blob.type });
  } catch {
    return blob;
  }
}
