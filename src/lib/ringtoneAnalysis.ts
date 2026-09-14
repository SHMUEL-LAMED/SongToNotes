export type RingtoneSections = {
  chorus: number;
  verse: number;
  instrumental: number;
  confidence: number;
};

function monoAt(buffer: AudioBuffer, index: number) {
  let value = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    value += buffer.getChannelData(channel)[index] ?? 0;
  }
  return value / Math.max(1, buffer.numberOfChannels);
}

/** Fast local section finder ported from the original Ringtones site. */
export function analyseRingtoneSections(buffer: AudioBuffer): RingtoneSections {
  const duration = buffer.duration;
  const hop = Math.max(0.8, Math.min(1.4, duration / 180));
  const span = Math.min(5.5, Math.max(3.2, duration * 0.06));
  const frames = Math.max(1, Math.floor((duration - span) / hop) + 1);
  const bands = [2, 3, 5, 7, 10, 14, 19, 26, 35, 47, 62, 82, 108];
  const windowSize = 256;
  const features: number[][] = [];

  for (let frame = 0; frame < frames; frame += 1) {
    const at = Math.min(
      Math.max(0, buffer.length - windowSize * 4),
      Math.max(0, Math.floor((frame * hop + span / 2) * buffer.sampleRate)),
    );
    let sum = 0;
    let crossings = 0;
    let previous = monoAt(buffer, at);
    const spectrum: number[] = [];
    for (const band of bands) {
      let real = 0;
      let imaginary = 0;
      for (let index = 0; index < windowSize; index += 1) {
        const sample = monoAt(buffer, at + index * 4);
        const angle = (2 * Math.PI * band * index) / windowSize;
        real += sample * Math.cos(angle);
        imaginary -= sample * Math.sin(angle);
      }
      spectrum.push(Math.log1p(real * real + imaginary * imaginary));
    }
    for (let index = 0; index < windowSize; index += 1) {
      const sample = monoAt(buffer, at + index * 4);
      sum += sample * sample;
      if ((sample >= 0) !== (previous >= 0)) crossings += 1;
      previous = sample;
    }
    const norm = Math.hypot(...spectrum) || 1;
    features.push([
      Math.log1p(Math.sqrt(sum / windowSize) * 18),
      crossings / windowSize,
      ...spectrum.map((value) => value / norm),
    ]);
  }

  const cosine = (left: number[], right: number[]) => {
    let dot = 0;
    let a = 0;
    let b = 0;
    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      a += left[index] * left[index];
      b += right[index] * right[index];
    }
    return dot / Math.sqrt(a * b || 1);
  };

  const energy = features.map((feature) => feature[0]);
  const mean = energy.reduce((sum, value) => sum + value, 0) / energy.length;
  const peak = Math.max(...energy, mean + 0.001);
  const width = Math.max(5, Math.round(Math.min(14, duration * 0.12) / hop));
  const gap = Math.max(width + 3, Math.round(16 / hop));
  let best = { score: -1, first: 0, second: 0 };
  for (let first = Math.max(1, Math.round(12 / hop)); first + width < frames; first += 1) {
    for (let second = first + gap; second + width < frames; second += 1) {
      let similarity = 0;
      for (let offset = 0; offset < width; offset += 1) {
        similarity += cosine(features[first + offset], features[second + offset]);
      }
      similarity /= width;
      const loudness = Math.min(
        1,
        ((energy[first] + energy[second]) / 2 - mean) / Math.max(0.001, peak - mean),
      );
      const score = similarity * 0.8 + loudness * 0.2;
      if (score > best.score) best = { score, first, second };
    }
  }

  const chorusFrame =
    best.score < 0
      ? Math.round(frames * 0.38)
      : energy[best.first] >= energy[best.second]
        ? best.first
        : best.second;
  let verseFrame = Math.max(0, Math.round(8 / hop));
  let verseEnergy = Number.POSITIVE_INFINITY;
  for (let frame = verseFrame; frame < Math.max(verseFrame + 1, chorusFrame - width); frame += 1) {
    if (energy[frame] < verseEnergy) {
      verseEnergy = energy[frame];
      verseFrame = frame;
    }
  }
  let instrumentalFrame = Math.round(frames * 0.65);
  let instrumentalChange = Number.POSITIVE_INFINITY;
  for (let frame = Math.max(1, Math.round(frames * 0.35)); frame < frames; frame += 1) {
    const change = 1 - cosine(features[frame], features[frame - 1]);
    if (change < instrumentalChange) {
      instrumentalChange = change;
      instrumentalFrame = frame;
    }
  }
  const cap = (frame: number) => Math.min(frame * hop, Math.max(0, duration - 10));
  return {
    chorus: cap(chorusFrame),
    verse: cap(verseFrame),
    instrumental: cap(instrumentalFrame),
    confidence: Math.max(0, Math.min(1, (best.score - 0.35) / 0.55)),
  };
}

function localLevel(buffer: AudioBuffer, at: number) {
  const center = Math.floor(at * buffer.sampleRate);
  const radius = Math.max(64, Math.floor(buffer.sampleRate * 0.09));
  let sum = 0;
  let count = 0;
  for (
    let index = Math.max(0, center - radius);
    index < Math.min(buffer.length, center + radius);
    index += 4
  ) {
    const sample = monoAt(buffer, index);
    sum += sample * sample;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

export function findNaturalBoundary(
  buffer: AudioBuffer,
  target: number,
  before: number,
  after: number,
) {
  const from = Math.max(0.15, target + before);
  const to = Math.min(buffer.duration - 0.15, target + after);
  const scale = Math.max(0.25, Math.abs(before) + Math.abs(after));
  let best = target;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let time = from; time <= to; time += 0.05) {
    const distance = Math.abs(time - target) / scale;
    const score = localLevel(buffer, time) * (1 + distance * 0.35) + distance * 0.012;
    if (score < bestScore) {
      best = time;
      bestScore = score;
    }
  }
  return Math.max(0, Math.min(best, buffer.duration));
}
