export type RecorderState = "idle" | "recording" | "stopping";

export function isRecordingSupported() {
  return (
    typeof navigator !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** Picks a container the browser can both record and decode back. */
function pickMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/**
 * Captures a hummed or sung take straight from the microphone. The recording
 * stays in memory and goes through the same local pipeline as an uploaded
 * file — nothing is sent anywhere.
 */
export class MicRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Uint8Array<ArrayBuffer> | null = null;
  private startedAt = 0;

  get state(): RecorderState {
    if (!this.recorder) return "idle";
    return this.recorder.state === "recording" ? "recording" : "stopping";
  }

  get elapsed() {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  /** 0..1 input level, for the meter. */
  get level() {
    if (!this.analyser || !this.buffer) return 0;
    this.analyser.getByteTimeDomainData(this.buffer);
    let peak = 0;
    for (let index = 0; index < this.buffer.length; index += 1) {
      peak = Math.max(peak, Math.abs(this.buffer[index] - 128) / 128);
    }
    return Math.min(1, peak * 1.6);
  }

  async start() {
    if (!isRecordingSupported()) {
      throw new Error("הדפדפן הזה אינו תומך בהקלטה מהמיקרופון.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (AudioContextClass) {
      this.context = new AudioContextClass();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.buffer = new Uint8Array(this.analyser.fftSize);
      this.context.createMediaStreamSource(this.stream).connect(this.analyser);
    }

    const mimeType = pickMimeType();
    this.chunks = [];
    this.recorder = new MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : undefined,
    );
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(250);
    this.startedAt = Date.now();
  }

  async stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("אין הקלטה פעילה.");

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" }));
      };
      if (recorder.state !== "inactive") recorder.stop();
      else resolve(new Blob(this.chunks));
    });

    this.cleanup();
    return blob;
  }

  cancel() {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.cleanup();
  }

  private cleanup() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.analyser = null;
    this.buffer = null;
    this.startedAt = 0;
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }
}

export function recordingExtension(blob: Blob) {
  if (blob.type.includes("mp4")) return "m4a";
  if (blob.type.includes("ogg")) return "ogg";
  return "webm";
}
