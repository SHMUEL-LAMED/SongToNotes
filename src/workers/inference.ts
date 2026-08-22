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

/**
 * How many 2-second windows to push through the graph at once. Batching pays
 * for itself on the GPU, where each execution costs a round trip regardless of
 * size. On the CPU kernels there is no round trip to amortise and larger
 * batches measured slower, so that path stays at one window.
 */
function batchSizeFor(backend: string) {
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
  const initialBatch = batchSizeFor(tf.getBackend());
  const framed = tf.tidy(() => {
    const padded = tf.concat1d([
      tf.zeros([Math.floor(OVERLAP_LENGTH_FRAMES / 2)], "float32"),
      tf.tensor1d(samples),
    ]);
    return tf.expandDims(
      tf.signal.frame(padded, AUDIO_N_SAMPLES, HOP_SIZE, true, 0),
      -1,
    ) as tf.Tensor3D;
  });

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  try {
    const windowCount = framed.shape[0];
    const expectedFrames = Math.floor(
      samples.length * (ANNOTATIONS_FPS / AUDIO_SAMPLE_RATE),
    );
    let produced = 0;
    let batchSize = initialBatch;

    for (let start = 0; start < windowCount; ) {
      onProgress(start / windowCount);
      const size = Math.min(batchSize, windowCount - start);

      let outputs: tf.Tensor2D[];
      try {
        outputs = tf.tidy(() => {
          const batch = tf.slice(
            framed,
            [start, 0, 0],
            [size, -1, -1],
          ) as tf.Tensor3D;
          const results = model.execute(
            batch,
            OUTPUT_TENSORS,
          ) as tf.Tensor3D[];
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

      const [batchFrames, batchOnsets, batchContours] = (await Promise.all(
        outputs.map((tensor) => tensor.array()),
      )) as number[][][];
      outputs.forEach((tensor) => tensor.dispose());

      // The final window runs past the end of the audio, so the tail is cut.
      const take = Math.min(batchFrames.length, expectedFrames - produced);
      for (let index = 0; index < take; index += 1) {
        frames.push(batchFrames[index]);
        onsets.push(batchOnsets[index]);
        contours.push(batchContours[index]);
      }
      produced += take;

      start += size;
      if (produced >= expectedFrames) break;
    }
  } finally {
    framed.dispose();
  }

  onProgress(1);
  return { frames, onsets, contours };
}
