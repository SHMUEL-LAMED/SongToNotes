import { loadArtwork, readVisualizerMedia, seekVideo, waitForVideo } from "../lib/visualizerMedia";
import {
  AudioWaveform,
  Clapperboard,
  Download,
  ImagePlus,
  Play,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AudioPicker, formatBytes, useAudioFile } from "../components/AudioPicker";
import { ShareButton } from "../components/ShareButton";
import { Waveform } from "../components/Waveform";
import { buildPeaks, formatTime } from "../lib/audio";
import { downloadFile } from "../lib/export";
import { Fft, hannWindow } from "../lib/fft";
import { useAssistantTool } from "../lib/useAssistantTool";
import {
  ASPECTS,
  BACKGROUNDS,
  STYLES,
  aspectSize,
  barCount,
  bassLevel,
  binLevels,
  blurredBackground,
  clampRegion,
  createParticles,
  defaultRegion,
  describeLength,
  drawScene,
  isAspect,
  isStyle,
  logBinRanges,
  magnitudesToBytes,
  normaliseHue,
  seededRandom,
  smoothLevels,
  stepParticles,
  titleFromFilename,
  videoFilename,
  DEFAULT_REGION_SECONDS,
  MAX_REGION_SECONDS,
  type BinRange,
  type Particle,
  type RecordingType,
  type Region,
  type SizedImage,
  type VisualizerAspect,
  type VisualizerBackground,
  type VisualizerStyle,
} from "../lib/visualizer";
import "./visualizer.css";

const FFT_SIZE = 4096;
const MIN_DB = -88;
const MAX_DB = -22;
const PARTICLE_COUNT = 150;
const VIDEO_FPS = 30;
/** Enough for gradients to stay smooth at 1080p without a 30-second clip passing 20 MB. */
const VIDEO_BITRATE = 5_000_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const STYLE_LABELS: Record<VisualizerStyle, string> = {
  bars: "עמודות",
  wave: "גל",
  circle: "עיגול",
  particles: "חלקיקים",
};
const ASPECT_LABELS: Record<VisualizerAspect, { label: string; note: string }> = {
  square: { label: "ריבוע", note: "1:1 · פוסט" },
  portrait: { label: "לאורך", note: "9:16 · סטורי" },
  landscape: { label: "רחב", note: "16:9 · יוטיוב" },
};
const BACKGROUND_LABELS: Record<VisualizerBackground, string> = {
  gradient: "צבע",
  dark: "כהה",
  image: "תמונה",
};

type Scene = {
  aspect: VisualizerAspect;
  style: VisualizerStyle;
  hue: number;
  background: VisualizerBackground;
  backgroundImage: SizedImage | null;
  cover: SizedImage | null;
  sourceVideo: HTMLVideoElement | null;
  title: string;
  artist: string;
};

type EngineEvents = {
  /** Called about ten times a second while something plays, with seconds into the region. */
  onTick?: (elapsed: number) => void;
  onPreviewEnd?: () => void;
  onRecordDone?: (blob: Blob, type: RecordingType) => void;
  onRecordError?: (message: string) => void;
};

type Session = {
  kind: "preview" | "record";
  source: AudioBufferSourceNode;
  video: HTMLVideoElement | null;
  offset: number;
  gain: GainNode;
  analyser: AnalyserNode;
  startedAt: number;
  length: number;
  raf: number;
  cancelled: boolean;
};

let sharedFft: Fft | null = null;

/**
 * Everything that has to outlive a render: the audio graph, the animation
 * loop, the encoder and the per-frame buffers. Keeping it in one plain
 * object (held in state, never recreated) means the 60 fps loop never goes
 * through React, and React only hears about progress ten times a second.
 */
class VisualizerEngine {
  canvas: HTMLCanvasElement | null = null;
  events: EngineEvents = {};
  private scene: Scene | null = null;
  private context: AudioContext | null = null;
  private session: Session | null = null;
  private levels = new Float32Array(0);
  private target = new Float32Array(0);
  private frequency = new Uint8Array(FFT_SIZE / 2);
  private wave = new Float32Array(FFT_SIZE / 2);
  private ranges: BinRange[] = [];
  private rangesKey = "";
  private random = seededRandom(11);
  private particles: Particle[] = createParticles(PARTICLE_COUNT, this.random);
  private background: { source: SizedImage; aspect: VisualizerAspect; canvas: HTMLCanvasElement } | null = null;
  private videoFrame: HTMLCanvasElement | null = null;
  private lastFrame = 0;
  private lastTick = 0;
  /**
   * Bumped by every start and stop. Opening a session awaits the audio
   * context, so a second click (or a stop, or leaving the page) can land in
   * between; a start that finds the number changed when it resumes drops its
   * session instead of installing it. Without this a double-click on play
   * left an orphaned source playing that no button could stop.
   */
  private generation = 0;
  private exporting = false;
  private offlineFrame: CanvasImageSource | null = null;

  get busy(): Session["kind"] | null {
    return this.exporting ? "record" : this.session?.kind ?? null;
  }

  setScene(scene: Scene) {
    this.scene = scene;
  }

  setEvents(events: EngineEvents) {
    this.events = events;
  }

  attachCanvas(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
  }

  /** Levels sized for the current style, reallocated only when the bar count changes. */
  private bands(sampleRate: number) {
    const scene = this.scene!;
    const count = barCount(scene.style, scene.aspect);
    const key = `${count}:${sampleRate}`;
    if (key !== this.rangesKey) {
      this.ranges = logBinRanges(count, FFT_SIZE, sampleRate);
      this.rangesKey = key;
    }
    if (this.levels.length !== count) {
      this.levels = new Float32Array(count);
      this.target = new Float32Array(count);
    }
    return this.ranges;
  }

  private paint(bass: number, time: number, particles: Particle[]) {
    const canvas = this.canvas;
    const scene = this.scene;
    if (!canvas || !scene) return;
    const { width, height } = aspectSize(scene.aspect);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let backgroundImage: CanvasImageSource | null = null;
    if (scene.background === "image" && scene.backgroundImage) {
      const cached = this.background;
      if (!cached || cached.source !== scene.backgroundImage || cached.aspect !== scene.aspect) {
        this.background = {
          source: scene.backgroundImage,
          aspect: scene.aspect,
          canvas: blurredBackground(scene.backgroundImage, width, height),
        };
      }
      backgroundImage = this.background!.canvas;
    }
    if (scene.sourceVideo?.readyState && scene.sourceVideo.readyState >= 2) {
      const video = scene.sourceVideo;
      this.videoFrame ??= document.createElement("canvas");
      if (this.videoFrame.width !== width) this.videoFrame.width = width;
      if (this.videoFrame.height !== height) this.videoFrame.height = height;
      const videoContext = this.videoFrame.getContext("2d")!;
      videoContext.fillStyle = "#000";
      videoContext.fillRect(0, 0, width, height);
      const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      videoContext.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
      backgroundImage = this.videoFrame;
    }
    if (this.offlineFrame) backgroundImage = this.offlineFrame;
    drawScene(ctx, {
      aspect: scene.aspect,
      style: scene.style,
      hue: scene.hue,
      background: scene.sourceVideo || this.offlineFrame ? "image" : scene.background,
      backgroundImage,
      cover: scene.cover,
      title: scene.title,
      artist: scene.artist,
      levels: this.levels,
      wave: this.wave,
      bass,
      time,
      particles,
    });
  }

  /**
   * A still frame for when nothing plays: the spectrum of the file a moment
   * into the region, computed directly, so the design can be judged on a
   * frame that looks like the song rather than on flat bars.
   */
  drawStill(buffer: AudioBuffer | null, at: number, exportTime?: number) {
    if (this.session || !this.scene) return;
    const ranges = this.bands(buffer?.sampleRate ?? 44_100);
    this.wave.fill(0);
    this.frequency.fill(0);
    if (buffer) {
      const start = Math.max(0, Math.min(buffer.length - FFT_SIZE, Math.round(at * buffer.sampleRate)));
      const mono = new Float32Array(FFT_SIZE);
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = 0; index < FFT_SIZE; index += 1) mono[index] += (data[start + index] ?? 0) / buffer.numberOfChannels;
      }
      this.wave.set(mono.subarray(0, this.wave.length));
      const window = hannWindow(FFT_SIZE);
      const windowed = mono.map((value, index) => value * window[index] * 2);
      sharedFft ??= new Fft(FFT_SIZE);
      const magnitudes = new Float32Array(FFT_SIZE / 2);
      sharedFft.magnitudes(windowed, magnitudes);
      magnitudesToBytes(magnitudes, FFT_SIZE, this.frequency, MIN_DB, MAX_DB);
    }
    binLevels(this.frequency, ranges, this.levels);
    // A fixed seed: the still frame's particles sit in the same places every
    // time a setting changes, instead of reshuffling on each keystroke.
    const bass = bassLevel(this.levels);
    if (exportTime !== undefined) {
      stepParticles(this.particles, 1 / VIDEO_FPS, bass, this.random);
      this.paint(bass, exportTime, this.particles);
    } else this.paint(bass, 0, createParticles(PARTICLE_COUNT, seededRandom(5)));
  }

  private async ensureContext() {
    if (!this.context || this.context.state === "closed") {
      const Context =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      this.context = new Context();
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  private async openSession(
    kind: Session["kind"],
    buffer: AudioBuffer,
    region: Region,
  ): Promise<Session> {
    const generation = this.generation;
    const context = await this.ensureContext();
    if (generation !== this.generation) throw new Error("הפעולה בוטלה.");
    const video = this.scene?.sourceVideo;
    if (video) {
      await seekVideo(video, region.start);
      if (generation !== this.generation) throw new Error("הפעולה בוטלה.");
      await video.play();
      if (generation !== this.generation) { video.pause(); throw new Error("הפעולה בוטלה."); }
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.45;
    analyser.minDecibels = MIN_DB;
    analyser.maxDecibels = MAX_DB;
    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(context.destination);
    const length = region.end - region.start;
    // A short lead-in and fades prevent clicks during preview playback.
    const startedAt = context.currentTime + 0.02;
    const fade = Math.min(0.04, length / 4);
    gain.gain.setValueAtTime(0, startedAt);
    gain.gain.linearRampToValueAtTime(1, startedAt + fade);
    gain.gain.setValueAtTime(1, startedAt + length - fade);
    gain.gain.linearRampToValueAtTime(0, startedAt + length);
    source.start(startedAt, region.start, length);
    return { kind, source, video: video ?? null, offset: region.start, gain, analyser, startedAt, length, raf: 0, cancelled: false };
  }

  private close(session: Session) {
    session.video?.pause();
    cancelAnimationFrame(session.raf);
    session.source.onended = null;
    try {
      session.source.stop();
    } catch {
      // Already stopped: nothing to do.
    }
    session.source.disconnect();
    session.gain.disconnect();
    session.analyser.disconnect();
    if (this.session === session) this.session = null;
  }

  private startLoop(session: Session) {
    this.lastFrame = performance.now();
    this.lastTick = 0;
    const tick = (now: number) => {
      if (this.session !== session || !this.context) return;
      // After a hidden tab comes back the gap can be seconds long; clamping
      // it keeps the smoothing and the particles from leaping.
      const dt = Math.min(0.1, Math.max(0.001, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      const elapsed = Math.max(0, Math.min(session.length, this.context.currentTime - session.startedAt));
      if (session.video && !session.video.seeking && Math.abs(session.video.currentTime - session.offset - elapsed) > 0.18) {
        session.video.currentTime = session.offset + elapsed;
      }
      const ranges = this.bands(this.context.sampleRate);
      session.analyser.getByteFrequencyData(this.frequency);
      session.analyser.getFloatTimeDomainData(this.wave);
      binLevels(this.frequency, ranges, this.target);
      smoothLevels(this.levels, this.target, 0.7, 0.16, dt);
      const bass = bassLevel(this.levels);
      stepParticles(this.particles, dt, bass, this.random);
      this.paint(bass, elapsed, this.particles);
      if (now - this.lastTick > 100) {
        this.lastTick = now;
        this.events.onTick?.(elapsed);
      }
      session.raf = requestAnimationFrame(tick);
    };
    session.raf = requestAnimationFrame(tick);
  }

  /** Resolves false when a later start or a stop overtook this one. */
  async startPreview(buffer: AudioBuffer, region: Region): Promise<boolean> {
    this.stop();
    const generation = ++this.generation;
    const session = await this.openSession("preview", buffer, region);
    if (generation !== this.generation) {
      this.close(session);
      return false;
    }
    this.session = session;
    session.source.onended = () => {
      if (this.session !== session) return;
      this.close(session);
      this.events.onPreviewEnd?.();
    };
    this.startLoop(session);
    return true;
  }

  /** Encodes explicit frames and PCM audio; no screen capture or wall-clock recording. */
  async startRecording(buffer: AudioBuffer, region: Region, file: File): Promise<boolean> {
    this.stop();
    const generation = ++this.generation;
    this.exporting = true;
    const scene = this.scene!;
    const events = this.events;
    const renderer = new VisualizerEngine();
    renderer.setScene({ ...scene, sourceVideo: null });
    const canvas = document.createElement("canvas");
    const size = aspectSize(scene.aspect);
    canvas.width = size.width;
    canvas.height = size.height;
    renderer.attachCanvas(canvas);
    const { Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource, AudioBufferSource,
      canEncodeVideo, canEncodeAudio, Input, BlobSource, ALL_FORMATS, CanvasSink } = await import("mediabunny");
    const active = () => generation === this.generation;
    const audioOptions = { sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels, bitrate: 192_000 };
    const videoOptions = { ...size, bitrate: VIDEO_BITRATE, frameRate: VIDEO_FPS };
    const mp4 = await canEncodeVideo("avc", videoOptions) && await canEncodeAudio("aac", audioOptions);
    if (!active()) return false;
    if (!mp4 && !(await canEncodeVideo("vp9", videoOptions) && await canEncodeAudio("opus", audioOptions))) {
      this.exporting = false;
      throw new Error("הדפדפן אינו תומך ביצירת קובץ וידאו ישירה. נסו Chrome או Edge עדכני.");
    }
    const type: RecordingType = mp4 ? { mimeType: "video/mp4", extension: "mp4" } : { mimeType: "video/webm", extension: "webm" };
    const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target: new BufferTarget() });
    const videoSource = new CanvasSource(canvas, { codec: mp4 ? "avc" : "vp9", bitrate: VIDEO_BITRATE });
    const audioSource = new AudioBufferSource({ codec: mp4 ? "aac" : "opus", bitrate: 192_000 });
    output.addVideoTrack(videoSource, { frameRate: VIDEO_FPS });
    output.addAudioTrack(audioSource);
    let input: InstanceType<typeof Input> | null = null;
    let frames: AsyncGenerator<Awaited<ReturnType<InstanceType<typeof CanvasSink>["getCanvas"]>>> | null = null;
    let completed = false;
    try {
      const length = region.end - region.start;
      const count = Math.ceil(length * VIDEO_FPS);
      if (scene.sourceVideo) {
        input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) throw new Error("לא ניתן לפענח את הסרטון הזה. נסו MP4 או WebM.");
        const sink = new CanvasSink(track, { ...size, fit: "contain", poolSize: 2 });
        frames = sink.canvasesAtTimestamps(Array.from({ length: count }, (_, index) => region.start + index / VIDEO_FPS));
      }
      await output.start();
      // Interleave short audio chunks with frames to bound encoder/muxer buffering.
      const firstSample = Math.round(region.start * buffer.sampleRate);
      const endSample = Math.min(buffer.length, Math.round(region.end * buffer.sampleRate));
      let audioSample = firstSample;
      for (let index = 0; index < count; index += 1) {
        if (!active()) return false;
        const time = index / VIDEO_FPS;
        if (frames) {
          const frame = await frames.next();
          if (!frame.value) throw new Error("לא נמצאה תמונת וידאו בקטע שנבחר.");
          renderer.offlineFrame = frame.value.canvas;
        }
        renderer.drawStill(buffer, region.start + time, time);
        await videoSource.add(time, Math.min(1 / VIDEO_FPS, length - time));
        const audioEnd = Math.min(endSample, firstSample + Math.round(Math.min(length, time + 1 / VIDEO_FPS) * buffer.sampleRate));
        if (audioEnd > audioSample) {
          const chunk = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: audioEnd - audioSample, sampleRate: buffer.sampleRate });
          for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
            chunk.copyToChannel(buffer.getChannelData(channel).subarray(audioSample, audioEnd), channel);
          }
          await audioSource.add(chunk);
          audioSample = audioEnd;
        }
        if (index % 10 === 0) {
          if (active()) events.onTick?.(time);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      if (!active()) return false;
      await output.finalize();
      completed = true;
      if (!active()) return false;
      const bytes = output.target.buffer;
      if (!bytes) throw new Error("יצירת קובץ הווידאו נכשלה.");
      events.onRecordDone?.(new Blob([bytes], { type: type.mimeType }), type);
      return true;
    } finally {
      if (!completed) await output.cancel();
      await frames?.return(undefined);
      input?.dispose();
      renderer.dispose();
      if (active()) this.exporting = false;
    }
  }

  /** Stops the preview, or abandons a recording without producing a file. */
  stop() {
    this.generation += 1;
    this.exporting = false;
    const session = this.session;
    if (!session) return;
    session.cancelled = true;
    this.close(session);
    // A context left suspended by a hidden-tab pause would silence the next preview.
    if (this.context?.state === "suspended") void this.context.resume();
  }

  dispose() {
    this.stop();
    this.events = {};
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") void context.close();
  }
}

function loadImage(file: File): Promise<SizedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      // A decoded image keeps drawing after its URL is gone, so nothing is
      // left to revoke later.
      URL.revokeObjectURL(url);
      resolve({ image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("לא הצלחנו לפתוח את התמונה. אפשר לנסות JPG או PNG."));
    };
    image.src = url;
  });
}

function canRecordVideo() {
  return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";
}

type Result = { blob: Blob; url: string; name: string; type: RecordingType };

/**
 * Turns a song into a video for social media: a region of the song drives
 * bars, a waveform, a ring or a particle cloud on a canvas, with the title,
 * the artist and a cover. Frames and audio are encoded directly to MP4 or WebM.
 */
export function VisualizerTool() {
  const { audio, error, setError, isLoading, progress, load, clear, maxBytes } = useAudioFile();
  const [engine] = useState(() => new VisualizerEngine());
  const renderToken = useRef(0);
  const [canRecord] = useState(canRecordVideo);
  const [seenUrl, setSeenUrl] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [style, setStyle] = useState<VisualizerStyle>("bars");
  const [aspect, setAspect] = useState<VisualizerAspect>("square");
  const [hue, setHue] = useState(268);
  const [background, setBackground] = useState<VisualizerBackground>("gradient");
  const [backgroundImage, setBackgroundImage] = useState<SizedImage | null>(null);
  const [cover, setCover] = useState<SizedImage | null>(null);
  const [sourceVideo, setSourceVideo] = useState<HTMLVideoElement | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaNote, setMediaNote] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);

  // A new song starts from its own first 30 seconds and its own name. This
  // is the render-time form of "reset when the input changes", which avoids
  // a frame drawn with the old song's region.
  if (audio && audio.url !== seenUrl) {
    setSeenUrl(audio.url);
    setCover(null);
    setBackgroundImage(null);
    setBackground("gradient");
    setArtist("");
    setSourceVideo(null);
    setMediaReady(false);
    setMediaNote("");
    setRegion(defaultRegion(audio.buffer.duration));
    setTitle(titleFromFilename(audio.file.name));
    setResult(null);
    setRenderError(null);
    setPlaying(false);
    setElapsed(0);
  }

  const duration = audio?.buffer.duration ?? 0;
  const activeRegion = audio ? (region ?? defaultRegion(duration)) : null;
  const regionLength = activeRegion ? activeRegion.end - activeRegion.start : 0;
  const peaks = useMemo(() => (audio ? buildPeaks(audio.buffer) : null), [audio]);
  const size = aspectSize(aspect);

  const scene = useMemo<Scene>(
    () => ({ aspect, style, hue, background, backgroundImage, cover, sourceVideo, title, artist }),
    [aspect, style, hue, background, backgroundImage, cover, sourceVideo, title, artist],
  );

  useEffect(() => {
    engine.setScene(scene);
  }, [engine, scene]);

  useEffect(() => {
    if (!audio) return;
    let alive = true;
    let video: HTMLVideoElement | null = null;
    void (async () => {
      try {
        const media = await readVisualizerMedia(audio.file);
        if (!alive) return;
        if (media.hasVideo) {
          video = document.createElement("video");
          video.muted = true;
          video.playsInline = true;
          video.preload = "auto";
          await waitForVideo(video, "loadeddata", () => { video!.src = audio.url; });
          if (!alive) return;
          setSourceVideo(video);
          setMediaNote("הסרטון המקורי משמש כרקע, עם פס הקול שלו.");
        } else if (media.cover) {
          const artwork = await loadArtwork(media.cover);
          if (!alive) return;
          setCover(artwork);
          setBackgroundImage(artwork);
          setBackground("image");
          setMediaNote("העטיפה חולצה מקובץ השמע ומשמשת לעיצוב התמונה והסרטון.");
        } else {
          setMediaNote("בקובץ אין עטיפה מוטמעת. אפשר לבחור תמונה ידנית.");
        }
        if (media.title) setTitle(media.title);
        if (media.artist) setArtist(media.artist);
      } catch (caught) {
        if (alive) setMediaNote(caught instanceof Error ? caught.message : "לא נמצאה עטיפה. אפשר לבחור תמונה ידנית.");
      } finally {
        if (alive) setMediaReady(true);
      }
    })();
    return () => {
      alive = false;
      if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
    };
  }, [audio]);

  // The canvas font is the site's; the still frame is painted again once it
  // has loaded, or the first frame would be set in the fallback face.
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) setFontsReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const stillAt = activeRegion ? activeRegion.start + Math.min(2, regionLength / 2) : 0;
  useEffect(() => {
    if (playing || recording) return;
    let alive = true;
    if (sourceVideo) {
      void seekVideo(sourceVideo, stillAt).then(() => {
        if (alive) engine.drawStill(audio?.buffer ?? null, stillAt);
      }).catch((caught) => { if (alive) setRenderError(String(caught)); });
    } else engine.drawStill(audio?.buffer ?? null, stillAt);
    return () => { alive = false; };
  }, [engine, scene, audio, stillAt, playing, recording, fontsReady, sourceVideo]);

  useEffect(() => {
    engine.setEvents({
      onTick: setElapsed,
      onPreviewEnd: () => {
        setPlaying(false);
        setElapsed(0);
      },
      onRecordDone: (blob, type) => {
        setRecording(false);
        setElapsed(0);
        setResult((previous) => {
          if (previous) URL.revokeObjectURL(previous.url);
          return {
            blob,
            url: URL.createObjectURL(blob),
            name: videoFilename(scene.title, audio?.file.name ?? "", scene.aspect, type.extension),
            type,
          };
        });
      },
      onRecordError: (message) => {
        setRecording(false);
        setElapsed(0);
        setRenderError(message);
      },
    });
  }, [engine, scene, audio]);

  // A new song, or leaving the page, ends whatever was playing or recording.
  useEffect(() => () => engine.stop(), [engine, audio]);
  useEffect(() => () => engine.dispose(), [engine]);
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );

  const play = async () => {
    if (!audio || !activeRegion || recording || !mediaReady) return false;
    setRenderError(null);
    try {
      if (!(await engine.startPreview(audio.buffer, activeRegion))) return false;
      setPlaying(true);
      setElapsed(0);
      return true;
    } catch {
      engine.stop();
      setRenderError("לא הצלחנו לנגן את הקטע בדפדפן הזה.");
      return false;
    }
  };

  const stopPreview = () => {
    if (engine.busy === "preview") engine.stop();
    setPlaying(false);
    setElapsed(0);
  };

  const startRender = async () => {
    if (!audio || !activeRegion || recording || !mediaReady) return false;
    if (!canRecord) {
      setRenderError("הדפדפן אינו תומך בייצוא וידאו ישיר. נסו Chrome או Edge עדכני.");
      return false;
    }
    setRenderError(null);
    setPlaying(false);
    setElapsed(0);
    setRecording(true);
    setResult(null);
    const token = ++renderToken.current;
    try {
      // A recording overtaken by a cancel or a second click leaves the page
      // state to whoever overtook it.
      const done = await engine.startRecording(audio.buffer, activeRegion, audio.file);
      if (token === renderToken.current && !done) setRecording(false);
      return done;
    } catch (caught) {
      if (token !== renderToken.current) return false;
      engine.stop();
      setRecording(false);
      setRenderError(caught instanceof Error ? caught.message : "לא הצלחנו ליצור את קובץ הווידאו.");
      return false;
    }
  };

  const cancelRender = () => {
    renderToken.current += 1;
    engine.stop();
    setRecording(false);
    setElapsed(0);
  };

  const changeRegion = (next: Region | null) => {
    // A video always has a region; the strip's "whole file" state is ignored.
    if (!next || !audio || recording) return;
    if (playing) stopPreview();
    setRegion(clampRegion(next, audio.buffer.duration));
  };

  const pickImage = async (file: File | undefined, apply: (image: SizedImage) => void) => {
    if (!file) return;
    setImageError(null);
    if (file.type && !file.type.startsWith("image/")) {
      setImageError("זה לא קובץ תמונה. אפשר לבחור JPG, PNG או WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(`התמונה גדולה מ־${formatBytes(MAX_IMAGE_BYTES)}.`);
      return;
    }
    try {
      apply(await loadImage(file));
    } catch (caught) {
      setImageError(caught instanceof Error ? caught.message : "לא הצלחנו לפתוח את התמונה.");
    }
  };

  const recordFraction = recording && regionLength > 0 ? Math.min(1, elapsed / regionLength) : 0;

  useAssistantTool("visualizer", {
    state: () =>
      `ויזואלייזר לשיר: ${
        audio && activeRegion
          ? `השיר „${audio.file.name}” (${formatTime(duration)}), הקטע ${formatTime(activeRegion.start)}–${formatTime(activeRegion.end)} (${describeLength(regionLength)})`
          : "לא נבחר שיר (רק הגולש בוחר קובץ)"
      }; סגנון ${style}, יחס ${aspect}, צבע ${hue}, רקע ${background}, כותרת „${title}”, אמן „${artist}”${cover ? ", יש תמונת עטיפה" : ""}; ${
        recording
          ? `יוצר קובץ וידאו (${Math.round(recordFraction * 100)}%)`
          : playing
            ? "התצוגה המקדימה מתנגנת"
            : result
              ? `סרטון מוכן: ${result.name} (${formatBytes(result.blob.size)})`
              : "אין סרטון עדיין"
      }.`,
    handlers: {
      "visualizer.set": ({ style: nextStyle, hue: nextHue, title: nextTitle, artist: nextArtist, aspect: nextAspect }) => {
        if (nextStyle !== undefined && !isStyle(nextStyle)) return { ok: false, message: "style הוא bars, wave, circle או particles" };
        if (nextAspect !== undefined && !isAspect(nextAspect)) return { ok: false, message: "aspect הוא square, portrait או landscape" };
        if (nextAspect !== undefined && recording && nextAspect !== aspect) return { ok: false, message: "אי אפשר לשנות את יחס המסך במהלך יצירת הקובץ" };
        if (nextHue !== undefined && !Number.isFinite(Number(nextHue))) return { ok: false, message: "hue הוא מספר בין 0 ל־360" };
        const changes: string[] = [];
        if (isStyle(nextStyle)) {
          setStyle(nextStyle);
          changes.push(`סגנון ${STYLE_LABELS[nextStyle]}`);
        }
        if (isAspect(nextAspect)) {
          setAspect(nextAspect);
          changes.push(`יחס ${ASPECT_LABELS[nextAspect].label}`);
        }
        if (nextHue !== undefined) {
          setHue(normaliseHue(Number(nextHue)));
          changes.push(`צבע ${normaliseHue(Number(nextHue))}`);
        }
        if (nextTitle !== undefined) {
          setTitle(String(nextTitle).slice(0, 120));
          changes.push("כותרת");
        }
        if (nextArtist !== undefined) {
          setArtist(String(nextArtist).slice(0, 120));
          changes.push("אמן");
        }
        if (!changes.length) return { ok: false, message: "לא התבקש שום שינוי" };
        return { ok: true, message: `עודכן: ${changes.join(", ")}` };
      },
      "visualizer.preview": async ({ command }) => {
        if (command === "stop") {
          stopPreview();
          return { ok: true, message: "התצוגה המקדימה נעצרה" };
        }
        if (command !== "play") return { ok: false, message: "command הוא play או stop" };
        if (!audio) return { ok: false, message: "לא נבחר שיר; הגולש צריך לבחור קובץ" };
        if (recording) return { ok: false, message: "יוצר עכשיו סרטון; אפשר לנגן כשהייצוא יסתיים" };
        const started = await play();
        return started ? { ok: true, message: `מנגן את הקטע (${describeLength(regionLength)})` } : { ok: false, message: "הניגון לא התחיל" };
      },
      "visualizer.render": async () => {
        if (!audio) return { ok: false, message: "לא נבחר שיר; הגולש צריך לבחור קובץ" };
        if (recording) return { ok: false, message: "כבר יוצר סרטון" };
        if (!canRecord) return { ok: false, message: "הדפדפן הזה לא תומך ביצירת וידאו ישירה" };
        const started = await startRender();
        return started
          ? {
              ok: true,
              message: "קובץ הווידאו נוצר ומוכן להורדה.",
            }
          : { ok: false, message: "יצירת הקובץ בוטלה או נכשלה" };
      },
    },
  });

  return (
    <section className="tool-body visualizer-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <AudioWaveform size={26} />
        </span>
        <div>
          <h1>סרטון ותמונה לשיתוף</h1>
          <p>מעלים שיר והעטיפה שלו נשלפת אוטומטית, או מעלים סרטון ומשתמשים בו כבסיס. מוסיפים עיצוב ושומרים סרטון או תמונה לשיתוף.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          progress={progress}
          maxBytes={maxBytes}
          onPick={(file) => {
            setError(null);
            if (recording) cancelRender();
            void load(file);
          }}
          onClear={() => {
            if (recording) cancelRender();
            clear();
          }}
          hint="שמע או וידאו: MP3, M4A, FLAC, MP4, WebM · בוחרים קטע של עד 3 דקות לסרטון"
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {audio && peaks && activeRegion && (
          <>
            <p role="status">{mediaReady ? mediaNote : "קורא את העטיפה ואת תמונת הסרטון…"}</p>
            <div className={`visualizer-region${recording ? " is-locked" : ""}`}>
              <div className="visualizer-region-head">
                <strong>הקטע לסרטון</strong>
                <span>
                  {describeLength(regionLength)} · עד {describeLength(MAX_REGION_SECONDS)}
                </span>
              </div>
              <Waveform
                peaks={peaks}
                duration={duration}
                trim={activeRegion}
                onTrimChange={changeRegion}
                cursor={playing || recording ? activeRegion.start + elapsed : null}
                selectLabel="הקטע"
                defaultSpan={DEFAULT_REGION_SECONDS}
                clickMoves
              />
            </div>

            <div className="visualizer-studio">
              <div className="visualizer-stage">
                <div className={`visualizer-frame is-${aspect}`}>
                  <canvas
                    ref={(node) => engine.attachCanvas(node)}
                    className="visualizer-canvas"
                    width={size.width}
                    height={size.height}
                    role="img"
                    aria-label={`תצוגה מקדימה של הסרטון: ${STYLE_LABELS[style]}, ${ASPECT_LABELS[aspect].label}`}
                  />
                </div>
                <div className="visualizer-stage-bar">
                  <button type="button" className="secondary-button" disabled={recording || !mediaReady} onClick={() => {
                    engine.canvas?.toBlob((blob) => {
                      if (blob) downloadFile(blob, `${title || "תמונה-לשיתוף"}.png`, "image/png");
                    }, "image/png");
                  }}><Download size={16} /> הורד תמונה</button>
                  {playing ? (
                    <button type="button" className="secondary-button" onClick={stopPreview}>
                      <Square size={16} /> עצור
                    </button>
                  ) : (
                    <button type="button" className="secondary-button" onClick={() => void play()} disabled={recording || !mediaReady}>
                      <Play size={16} /> נגן תצוגה מקדימה
                    </button>
                  )}
                  <span className="visualizer-time" dir="ltr">
                    {formatTime(playing || recording ? elapsed : 0)} / {formatTime(regionLength)}
                  </span>
                </div>
              </div>

              <div className="settings-panel visualizer-settings" inert={recording || !mediaReady}>
                <div className="setting-field">
                  <span id="visualizer-style">סגנון</span>
                  <div className="segmented-control wrap" role="group" aria-labelledby="visualizer-style">
                    {STYLES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={style === option ? "active" : ""}
                        aria-pressed={style === option}
                        onClick={() => setStyle(option)}
                      >
                        {STYLE_LABELS[option]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-field">
                  <span id="visualizer-aspect">גודל הסרטון</span>
                  <div className="segmented-control visualizer-aspects" role="group" aria-labelledby="visualizer-aspect">
                    {ASPECTS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={aspect === option ? "active" : ""}
                        aria-pressed={aspect === option}
                        disabled={recording}
                        onClick={() => setAspect(option)}
                      >
                        {ASPECT_LABELS[option].label}
                        <small>{ASPECT_LABELS[option].note}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <label className="setting-field">
                  <span>
                    צבע
                    <i className="visualizer-swatch" style={{ background: `hsl(${hue}, 90%, 60%)` }} aria-hidden="true" />
                    <b>{hue}°</b>
                  </span>
                  <input
                    className="visualizer-hue"
                    type="range"
                    min={0}
                    max={359}
                    value={hue}
                    onChange={(event) => setHue(Number(event.target.value))}
                    aria-valuetext={`גוון ${hue}`}
                  />
                </label>

                <div className="setting-field">
                  <span id="visualizer-background">רקע</span>
                  <div className="segmented-control" role="group" aria-labelledby="visualizer-background">
                    {BACKGROUNDS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={background === option ? "active" : ""}
                        aria-pressed={background === option}
                        onClick={() => setBackground(option)}
                      >
                        {BACKGROUND_LABELS[option]}
                      </button>
                    ))}
                  </div>
                  {background === "image" && (
                    <div className="visualizer-image-row">
                      <label className="secondary-button compact">
                        <ImagePlus size={16} /> {backgroundImage ? "החלף תמונת רקע" : "בחר תמונת רקע"}
                        <input
                          className="native-file-input"
                          type="file"
                          accept="image/*"
                          aria-label="בחירת תמונת רקע"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            void pickImage(file, setBackgroundImage);
                          }}
                        />
                      </label>
                      {backgroundImage && (
                        <button type="button" className="icon-button" aria-label="הסר את תמונת הרקע" onClick={() => setBackgroundImage(null)}>
                          <X size={16} />
                        </button>
                      )}
                      <small>{backgroundImage ? "התמונה מטושטשת ומוחשכת כדי שהטקסט ייקרא." : "עד שתיבחר תמונה, הרקע נצבע לפי הגוון."}</small>
                    </div>
                  )}
                </div>

                <label className="setting-field">
                  <span>שם השיר</span>
                  <input type="text" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="שם השיר" dir="auto" />
                </label>
                <label className="setting-field">
                  <span>אמן</span>
                  <input type="text" value={artist} maxLength={120} onChange={(event) => setArtist(event.target.value)} placeholder="שם האמן (לא חובה)" dir="auto" />
                </label>

                <div className="setting-field">
                  <span>תמונת עטיפה</span>
                  <div className="visualizer-image-row">
                    <label className="secondary-button compact">
                      <ImagePlus size={16} /> {cover ? "החלף תמונה" : "הוסף תמונה"}
                      <input
                        className="native-file-input"
                        type="file"
                        accept="image/*"
                        aria-label="בחירת תמונת עטיפה"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          void pickImage(file, setCover);
                        }}
                      />
                    </label>
                    {cover && (
                      <button type="button" className="secondary-button compact" onClick={() => setCover(null)}>
                        <Trash2 size={15} /> הסר
                      </button>
                    )}
                  </div>
                  <small>{style === "circle" ? "בסגנון העיגול התמונה מסתובבת במרכז כמו תקליט." : "מוצגת מעל שם השיר."}</small>
                </div>
                {imageError && (
                  <div className="error-message" role="alert">
                    {imageError}
                  </div>
                )}
              </div>
            </div>

            <p className="notice-message visualizer-note">
              <Clapperboard size={17} aria-hidden="true" />
              <span>
                קובץ הווידאו נוצר ישירות מהשמע ומהתמונות, ללא הקלטת מסך וללא השמעת השיר בזמן הייצוא. אפשר לעבור ללשונית אחרת; יש להשאיר את הדף פתוח עד לסיום.
              </span>
            </p>

            {!canRecord && (
              <div className="error-message" role="alert">
                הדפדפן הזה לא יודע להקליט וידאו מהדף. אפשר לנסות ב־Chrome, Edge, Firefox או Safari עדכני.
              </div>
            )}

            {recording ? (
              <div className="processing-box" aria-live="polite">
                <div className="processing-top">
                  <span>
                    <Sparkles size={18} /> יוצר קובץ וידאו…
                  </span>
                  <strong>{Math.round(recordFraction * 100)}%</strong>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="התקדמות יצירת הקובץ"
                  aria-valuenow={Math.round(recordFraction * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div style={{ width: `${Math.max(2, recordFraction * 100)}%` }} />
                </div>
                <div className="processing-bottom">
                  <small>
                    {formatTime(elapsed)} מתוך {formatTime(regionLength)}. הקובץ נוצר ללא השמעה וללא הקלטת מסך.
                  </small>
                  <button type="button" className="secondary-button compact is-danger" onClick={cancelRender}>
                    <X size={16} /> בטל
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="primary-button" onClick={() => void startRender()} disabled={!canRecord || !mediaReady}>
                <Clapperboard size={20} /> צור סרטון <small>· {describeLength(regionLength)}</small>
              </button>
            )}

            {renderError && (
              <div className="error-message" role="alert">
                {renderError}
              </div>
            )}

            {result && !recording && (
              <div className="downloads-card visualizer-result">
                <div>
                  <span className="download-icon">
                    <Download size={22} />
                  </span>
                  <div>
                    <h3>{result.name}</h3>
                    <p>
                      {formatBytes(result.blob.size)} · {result.type.extension.toUpperCase()}
                      {result.type.extension === "webm" ? " · הדפדפן הזה תומך בייצוא ישיר ל־WebM." : ""}
                    </p>
                  </div>
                </div>
                <video className={`visualizer-result-video is-${aspect}`} src={result.url} controls playsInline aria-label="הסרטון שנוצר" />
                <div className="download-buttons">
                  <button type="button" onClick={() => downloadFile(result.blob, result.name, result.blob.type)}>
                    <Download size={17} />
                    <span>
                      הורד את הסרטון<small>{result.type.extension.toUpperCase()}</small>
                    </span>
                  </button>
                  <ShareButton build={() => new File([result.blob], result.name, { type: result.blob.type })} title={title || result.name} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
