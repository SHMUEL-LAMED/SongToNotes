import * as tf from "@tensorflow/tfjs";

/** Model constants, mirrored from basic_pitch/constants.py. */
const AUDIO_SAMPLE_RATE = 22_050;
const FFT_HOP = 256;
const ANNOTATIONS_FPS = Math.floor(AUDIO_SAMPLE_RATE / FFT_HOP);
const AUDIO_N_SAMPLES = AUDIO_SAMPLE_RATE * 2 - FFT_HOP;
const N_OVERLAPPING_FRAMES = 30;
const N_OVERLAP_OVER_2 = N_OVERLAPPING_FRAMES / 2;
const OVERLAP_LENGTH_FRAMES = N_OVERLAPPING_FRAMES * FFT_HOP;
const HOP_SIZE = AUDIO_N_SAMPLES - OVERLAP_LENGTH_FRAMES;

const OUTPUT_TENSORS = ["Identity_1", "Identity_2", "Identity"];

/** GPU inference is much faster when several windows share one execution. */
function preferredBatchSize(backend: string) {
  return backend === "webgl" ? 8 : 1;
}

export type ModelOutput = {
  frames: number[][];
  onsets: number[][];
  contours: number[][];
};

function unwrap(result: tf.Tensor3D): tf.Tensor2D {
  // Each window is evaluated with padding on both sides; the overlap is
  // trimmed so consecutive windows join without duplicating frames.
  const trimmed = result.slice(
    [0, N_OVERLAP_OVER_2, 0],
    [-1, result.shape[1] - 2 * N_OVERLAP_OVER_2, -1],
  );
  const [batch, steps, channels] = trimmed.shape;
  // Windows in a batch are consecutive, so flattening the batch axis yields
  // exactly the sequence a one-at-a-time loop would have produced.
  return trimmed.reshape([batch * steps, channels]) as tf.Tensor2D;
}

/**
 * Runs the model over the audio.
 *
 * The library's own `evaluateModel` is not used because it evaluates a single
 * 2-second window per call — one graph execution and one GPU round trip for
 * every 1.6 seconds of audio — and disposes none of the tensors it allocates,
 * so a long recording accumulates every intermediate result until the run
 * ends. This loop batches the windows and frees each batch as it goes.
 */
export async function runInference(
  model: tf.GraphModel,
  samples: Float32Array,
  onProgress: (fraction: number) => void,
): Promise<ModelOutput> {
  const backend = tf.getBackend();
  const preferredBatch = preferredBatchSize(backend);
  const leftPadding = Math.floor(OVERLAP_LENGTH_FRAMES / 2);
  const paddedLength = leftPadding + samples.length;
  const windowCount = Math.max(1, Math.ceil(paddedLength / HOP_SIZE));

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  const expectedFrames = Math.floor(
    samples.length * (ANNOTATIONS_FPS / AUDIO_SAMPLE_RATE),
  );
  let produced = 0;
  // Compile and validate the graph with one small window first. This moves the
  // progress bar beyond 4% quickly and avoids asking weaker GPUs to compile a
  // large first execution. Once it succeeds, WebGL switches to the faster
  // eight-window batches used by the original optimized path.
  let batchSize = 1;

  for (let start = 0; start < windowCount; ) {
    onProgress(start / windowCount);
    // Give React a chance to paint the progress value before the next model
    // execution. This matters when WebGL is only available on the main thread.
    await tf.nextFrame();
    const size = Math.min(batchSize, windowCount - start);

    // Build only the windows needed for this batch. The previous implementation
    // materialised a framed tensor for the entire song up front; on longer
    // tracks that duplicated tens of megabytes on the GPU before inference had
    // even begun and could leave the page permanently stuck at 4%.
    const batchSamples = new Float32Array(size * AUDIO_N_SAMPLES);
    for (let batchIndex = 0; batchIndex < size; batchIndex += 1) {
      const paddedStart = (start + batchIndex) * HOP_SIZE;
      const sourceStart = Math.max(0, paddedStart - leftPadding);
      const destinationStart = Math.max(0, leftPadding - paddedStart);
      const available = Math.min(
        AUDIO_N_SAMPLES - destinationStart,
        samples.length - sourceStart,
      );
      if (available > 0) {
        batchSamples.set(
          samples.subarray(sourceStart, sourceStart + available),
          batchIndex * AUDIO_N_SAMPLES + destinationStart,
        );
      }
    }

    let outputs: tf.Tensor2D[];
    try {
      outputs = tf.tidy(() => {
        const batch = tf.tensor3d(batchSamples, [
          size,
          AUDIO_N_SAMPLES,
          1,
        ]);
        const results = model.execute(batch, OUTPUT_TENSORS) as tf.Tensor3D[];
        return results.map(unwrap);
      });
    } catch (error) {
      // Some exported graphs pin the batch dimension to one. Drop to
      // single-window evaluation and carry on rather than failing.
      if (size > 1) {
        batchSize = 1;
        continue;
      }
      throw error;
    }

    try {
      const [batchFrames, batchOnsets, batchContours] = (await Promise.all(
        outputs.map((tensor) => tensor.array()),
      )) as number[][][];

      // The final window runs past the end of the audio, so the tail is cut.
      const take = Math.min(batchFrames.length, expectedFrames - produced);
      for (let index = 0; index < take; index += 1) {
        frames.push(batchFrames[index]);
        onsets.push(batchOnsets[index]);
        contours.push(batchContours[index]);
      }
      produced += take;
    } finally {
      outputs.forEach((tensor) => tensor.dispose());
    }

    start += size;
    onProgress(Math.min(1, start / windowCount));
    if (batchSize === 1 && preferredBatch > 1) batchSize = preferredBatch;
    if (produced >= expectedFrames) break;
  }

  onProgress(1);
  return { frames, onsets, contours };
}
