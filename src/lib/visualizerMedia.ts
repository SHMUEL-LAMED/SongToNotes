import type { SizedImage } from "./visualizer";

export async function readVisualizerMedia(file: File) {
  const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const tags = await input.getMetadataTags();
    const image = tags.images?.find((item) => item.kind === "coverFront") ?? tags.images?.[0];
    return {
      title: tags.title,
      artist: tags.artist ?? tags.albumArtist,
      cover: image && image.data.byteLength <= 25 * 1024 * 1024
        ? new Blob([new Uint8Array(image.data)], { type: image.mimeType }) : null,
      hasVideo: Boolean(await input.getPrimaryVideoTrack()),
    };
  } finally {
    input.dispose();
  }
}

export function loadArtwork(blob: Blob): Promise<SizedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("לא הצלחנו לפתוח את תמונת העטיפה."));
    };
    image.src = url;
  });
}

export function waitForVideo(video: HTMLVideoElement, event: "loadeddata" | "seeked", action: () => void) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("לא הצלחנו לקרוא את תמונת הסרטון. נסו קובץ MP4 או WebM.")); };
    const timer = setTimeout(failed, 15000);
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
    try { action(); } catch { failed(); }
  });
}

export async function seekVideo(video: HTMLVideoElement, at: number) {
  const target = Math.max(0, Math.min(at, Math.max(0, video.duration - 0.01)));
  if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) return;
  await waitForVideo(video, "seeked", () => { video.currentTime = target; });
}
