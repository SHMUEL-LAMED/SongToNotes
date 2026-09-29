import { describe, expect, it } from "vitest";
import {
  aspectSize,
  bassLevel,
  binLevels,
  chooseRecordingType,
  clampRegion,
  containerMime,
  createParticles,
  defaultRegion,
  describeLength,
  extensionForMime,
  fitText,
  isRtl,
  logBinRanges,
  magnitudesToBytes,
  mirroredBarLayout,
  normaliseHue,
  rampColor,
  sceneLayout,
  seededRandom,
  smoothLevels,
  stepParticles,
  titleFromFilename,
  videoFilename,
  ASPECTS,
  MAX_REGION_SECONDS,
  RECORDING_CANDIDATES,
  STYLES,
} from "./visualizer";

describe("logBinRanges", () => {
  const ranges = logBinRanges(40, 4096, 44_100);

  it("covers the spectrum in contiguous, non-empty bands", () => {
    expect(ranges).toHaveLength(40);
    for (let index = 0; index < ranges.length; index += 1) {
      const [start, end] = ranges[index];
      expect(end).toBeGreaterThan(start);
      if (index > 0) expect(start).toBe(ranges[index - 1][1]);
    }
    expect(ranges[ranges.length - 1][1]).toBeLessThanOrEqual(2048);
  });

  it("starts near the lowest frequency and ends near the highest", () => {
    const binHz = 44_100 / 4096;
    expect(ranges[0][0] * binHz).toBeLessThan(40);
    expect(ranges[ranges.length - 1][1] * binHz).toBeGreaterThan(13_000);
    expect(ranges[ranges.length - 1][1] * binHz).toBeLessThan(14_500);
  });

  it("gives the treble wider bands than the bass (log spacing)", () => {
    const width = (range: [number, number]) => range[1] - range[0];
    expect(width(ranges[39])).toBeGreaterThan(width(ranges[20]));
    expect(width(ranges[20])).toBeGreaterThan(width(ranges[2]));
    // A linear split would hand the top octave (7–14 kHz) about half the
    // bars; log spacing gives it roughly one in nine.
    const topOctave = ranges.filter(([start]) => start * (44_100 / 4096) >= 7000).length;
    expect(topOctave).toBeLessThanOrEqual(6);
  });

  it("never runs past Nyquist on a low sample rate", () => {
    const low = logBinRanges(60, 2048, 16_000);
    for (const [start, end] of low) {
      expect(start).toBeLessThan(1024);
      expect(end).toBeLessThanOrEqual(1024);
    }
  });
});

describe("binLevels", () => {
  it("reads the loudness of each band on a 0..1 scale", () => {
    const spectrum = new Uint8Array(64);
    spectrum.fill(255, 10, 20);
    const levels = binLevels(spectrum, [[0, 10], [10, 20], [20, 30]], undefined, 255, 0);
    expect(Array.from(levels)).toEqual([0, 1, 0]);
  });

  it("blends peak and mean, and tilts the upper bands up", () => {
    const spectrum = [0, 200, 100, 100];
    const flat = binLevels(spectrum, [[0, 2], [2, 4]], undefined, 200, 0);
    expect(flat[0]).toBeCloseTo((200 + 100) / 2 / 200);
    expect(flat[1]).toBeCloseTo(0.5);
    const tilted = binLevels(spectrum, [[0, 2], [2, 4]], undefined, 200, 0.5);
    expect(tilted[0]).toBeCloseTo(flat[0]);
    expect(tilted[1]).toBeCloseTo(0.75);
  });

  it("clamps to 1", () => {
    const levels = binLevels([255, 255], [[0, 2]], undefined, 255, 1);
    expect(levels[0]).toBe(1);
  });
});

describe("smoothLevels", () => {
  it("rises fast and falls slowly", () => {
    const current = new Float32Array([0, 1]);
    smoothLevels(current, [1, 0], 0.6, 0.1);
    expect(current[0]).toBeCloseTo(0.6);
    expect(current[1]).toBeCloseTo(0.9);
  });

  it("is independent of the frame rate", () => {
    const at60 = new Float32Array([1]);
    smoothLevels(at60, [0], 0.6, 0.1, 1 / 60);
    smoothLevels(at60, [0], 0.6, 0.1, 1 / 60);
    const at30 = new Float32Array([1]);
    smoothLevels(at30, [0], 0.6, 0.1, 1 / 30);
    expect(at30[0]).toBeCloseTo(at60[0], 5);
  });

  it("converges on a steady target", () => {
    const current = new Float32Array([0]);
    for (let frame = 0; frame < 200; frame += 1) smoothLevels(current, [0.5]);
    expect(current[0]).toBeCloseTo(0.5, 4);
  });
});

describe("bassLevel", () => {
  it("averages the lowest bands", () => {
    expect(bassLevel([1, 1, 0, 0, 0, 0, 0, 0, 0, 0], 0.2)).toBe(1);
    expect(bassLevel([0, 0, 1, 1, 1, 1, 1, 1, 1, 1], 0.2)).toBe(0);
  });
});

describe("magnitudesToBytes", () => {
  it("maps decibels onto the analyser's byte scale", () => {
    const out = new Uint8Array(3);
    // |X|/N of 1 is 0 dB (above max), 1e-5 is -100 dB (below min), and
    // 10^(-55/20) sits halfway between -88 and -22.
    magnitudesToBytes([1024, 1024 * 1e-5, 1024 * Math.pow(10, -55 / 20)], 1024, out, -88, -22);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeGreaterThan(125);
    expect(out[2]).toBeLessThan(130);
  });

  it("treats silence as zero", () => {
    const out = new Uint8Array(2);
    magnitudesToBytes([0, 0], 1024, out, -90, -20);
    expect(Array.from(out)).toEqual([0, 0]);
  });
});

describe("aspectSize", () => {
  it("returns the social-media frame sizes", () => {
    expect(aspectSize("square")).toEqual({ width: 1080, height: 1080 });
    expect(aspectSize("portrait")).toEqual({ width: 1080, height: 1920 });
    expect(aspectSize("landscape")).toEqual({ width: 1920, height: 1080 });
  });

  it("keeps every layout inside its frame", () => {
    for (const aspect of ASPECTS) {
      const { width, height } = aspectSize(aspect);
      for (const style of STYLES) {
        for (const hasCover of [false, true]) {
          const layout = sceneLayout(aspect, style, hasCover);
          expect(layout.area.x).toBeGreaterThanOrEqual(0);
          expect(layout.area.x + layout.area.width).toBeLessThanOrEqual(width);
          expect(layout.titleY).toBeLessThan(layout.watermarkY);
          expect(layout.artistY).toBeLessThan(layout.watermarkY);
          expect(layout.watermarkY).toBeLessThan(height);
          if (layout.cover) {
            expect(layout.cover.x + layout.cover.width).toBeLessThanOrEqual(width);
            expect(layout.cover.y + layout.cover.height).toBeLessThan(layout.area.y);
          }
          if (style === "circle") expect(layout.cover).toBeNull();
          if (!hasCover) expect(layout.cover).toBeNull();
        }
      }
    }
  });
});

describe("mirroredBarLayout", () => {
  it("fits both halves in the area with gaps between bars", () => {
    const { step, barWidth } = mirroredBarLayout(36, 920);
    expect(step * 72).toBeCloseTo(920);
    expect(barWidth).toBeLessThan(step);
    expect(barWidth).toBeGreaterThan(0);
  });
});

describe("regions", () => {
  it("defaults to the first 30 seconds, or the whole of a short file", () => {
    expect(defaultRegion(200)).toEqual({ start: 0, end: 30 });
    expect(defaultRegion(8)).toEqual({ start: 0, end: 8 });
  });

  it("caps the length and keeps the start", () => {
    expect(clampRegion({ start: 10, end: 400 }, 500)).toEqual({ start: 10, end: 10 + MAX_REGION_SECONDS });
  });

  it("stays inside the file and never shrinks below the minimum", () => {
    expect(clampRegion({ start: -5, end: 900 }, 60)).toEqual({ start: 0, end: 60 });
    expect(clampRegion({ start: 59.8, end: 59.9 }, 60)).toEqual({ start: 59, end: 60 });
    expect(clampRegion({ start: 0, end: 0.2 }, 0.5)).toEqual({ start: 0, end: 0.5 });
  });

  it("describes a length the way it is said", () => {
    expect(describeLength(1)).toBe("שנייה אחת");
    expect(describeLength(30)).toBe("30 שניות");
    expect(describeLength(60)).toBe("דקה אחת");
    expect(describeLength(180)).toBe("3 דקות");
    expect(describeLength(125)).toBe("2:05 דקות");
  });
});

describe("chooseRecordingType", () => {
  const supporting = (...types: string[]) => (candidate: string) => types.includes(candidate);

  it("prefers MP4 when the browser can record it", () => {
    const type = chooseRecordingType(supporting("video/mp4", "video/webm;codecs=vp9,opus", "video/webm"));
    expect(type).toEqual({ mimeType: "video/mp4", extension: "mp4" });
  });

  it("takes the most specific MP4 flavour first", () => {
    const type = chooseRecordingType(() => true);
    expect(type?.mimeType).toBe(RECORDING_CANDIDATES[0]);
    expect(type?.extension).toBe("mp4");
  });

  it("falls back to VP9, then VP8, then plain WebM", () => {
    expect(chooseRecordingType(supporting("video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus"))?.mimeType).toBe(
      "video/webm;codecs=vp9,opus",
    );
    expect(chooseRecordingType(supporting("video/webm;codecs=vp8,opus", "video/webm"))?.mimeType).toBe("video/webm;codecs=vp8,opus");
    expect(chooseRecordingType(supporting("video/webm"))).toEqual({ mimeType: "video/webm", extension: "webm" });
  });

  it("returns null when nothing is supported, and survives a throwing probe", () => {
    expect(chooseRecordingType(() => false)).toBeNull();
    expect(
      chooseRecordingType((candidate) => {
        if (candidate.startsWith("video/mp4")) throw new Error("unsupported");
        return candidate === "video/webm";
      }),
    ).toEqual({ mimeType: "video/webm", extension: "webm" });
  });

  it("labels the file by its container", () => {
    expect(extensionForMime("video/mp4;codecs=avc1,opus")).toBe("mp4");
    expect(extensionForMime("video/webm;codecs=vp8,opus")).toBe("webm");
    expect(containerMime("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(containerMime("video/mp4")).toBe("video/mp4");
  });
});

describe("file names", () => {
  it("keeps Hebrew and names the frame", () => {
    expect(videoFilename("שיר של יום", "track.mp3", "portrait", "mp4")).toBe("שיר-של-יום-סרטון-סטורי.mp4");
    expect(videoFilename("", "My Song.wav", "square", "webm")).toBe("My-Song-סרטון-ריבוע.webm");
    expect(videoFilename("  ", "", "landscape", "mp4")).toBe("שיר-סרטון-רחב.mp4");
  });

  it("strips characters a file system would reject", () => {
    const name = videoFilename('a/b:c*d?"e', "x.mp3", "square", "mp4");
    expect(name).not.toMatch(/[/:*?"]/);
    expect(name.endsWith(".mp4")).toBe(true);
  });

  it("turns a file name into a title", () => {
    expect(titleFromFilename("my_song.final.mp3")).toBe("my song.final");
    expect(titleFromFilename("שיר.wav")).toBe("שיר");
  });
});

describe("text", () => {
  it("detects right-to-left strings", () => {
    expect(isRtl("שלום")).toBe(true);
    expect(isRtl("Hello שלום")).toBe(true);
    expect(isRtl("Hello")).toBe(false);
  });

  it("shrinks text to fit, then cuts it with an ellipsis", () => {
    const measure = (text: string, size: number) => Array.from(text).length * size * 0.5;
    expect(fitText("abcd", measure, 1000, 80, 40)).toEqual({ text: "abcd", size: 80 });
    const shrunk = fitText("abcdefghij", measure, 300, 80, 40);
    expect(shrunk.text).toBe("abcdefghij");
    expect(measure(shrunk.text, shrunk.size)).toBeLessThanOrEqual(300);
    const cut = fitText("abcdefghijklmnopqrstuvwxyz", measure, 300, 80, 40);
    expect(cut.size).toBe(40);
    expect(cut.text.endsWith("…")).toBe(true);
    expect(measure(cut.text, cut.size)).toBeLessThanOrEqual(300);
  });
});

describe("colour", () => {
  it("wraps hues and walks along the ramp", () => {
    expect(normaliseHue(370)).toBe(10);
    expect(normaliseHue(-30)).toBe(330);
    expect(normaliseHue(Number.NaN)).toBe(0);
    expect(rampColor(300, 0)).toBe("hsla(300, 92%, 58%, 1)");
    expect(rampColor(300, 1, 0.5)).toBe("hsla(10, 92%, 70%, 0.5)");
  });
});

describe("particles", () => {
  it("move outwards faster with more bass, and respawn at the centre", () => {
    const quiet = createParticles(50, seededRandom(3));
    const loud = createParticles(50, seededRandom(3));
    const before = quiet.map((particle) => particle.radius);
    stepParticles(quiet, 0.05, 0, seededRandom(9));
    stepParticles(loud, 0.05, 1, seededRandom(9));
    let quietTravel = 0;
    let loudTravel = 0;
    quiet.forEach((particle, index) => {
      if (particle.radius > before[index]) quietTravel += particle.radius - before[index];
    });
    loud.forEach((particle, index) => {
      if (particle.radius > before[index]) loudTravel += particle.radius - before[index];
    });
    expect(loudTravel).toBeGreaterThan(quietTravel * 3);

    const edge = [{ angle: 0, radius: 0.999, speed: 0.2, size: 1, tone: 0.5 }];
    stepParticles(edge, 0.1, 1, seededRandom(1));
    expect(edge[0].radius).toBeLessThan(0.1);
  });

  it("are reproducible from a seed", () => {
    expect(createParticles(5, seededRandom(42))).toEqual(createParticles(5, seededRandom(42)));
  });
});
