import type { DemucsResult, DemucsStem } from "demucs-web";

export type SeparationProgress = {
  phase: "model" | "separation";
  progress: number;
  message: string;
};
export type SeparatedStems = {
  vocals: [Float32Array, Float32Array];
  instrumental: [Float32Array, Float32Array];
  sampleRate: number;
};

/**
 * A failure whose message is written for the person on screen. Anything else
 * that escapes the separator is a technical error that belongs in the console,
 * not in front of a visitor — see {@link describeSeparationError}.
 */
export class SeparationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SeparationError";
  }
}

const MODEL_SAMPLE_RATE = 44_100;

/**
 * The model is copied into the build next to the rest of the site (see
 * `scripts/fetch-separation-model.mjs`), so a visitor never has to reach a
 * third-party host: whatever network lets them open the site lets them use
 * the separation. The upstream URL stays as a fallback for a build that was
 * made without the model, such as a local dev server.
 */
const SITE_MODEL_URL = `${import.meta.env.BASE_URL}model/htdemucs_embedded.onnx`;

/**
 * How big that copy is, stamped in at build time, so the progress bar moves
 * even where the server leaves out Content-Length. Zero when the build shipped
 * without the model.
 */
const SITE_MODEL_BYTES: number = __SEPARATION_MODEL_BYTES__;

/**
 * Where the weights are kept once they have arrived, so the wait happens once
 * per device rather than once per visit. The offline worker deliberately
 * refuses to store anything this large in its own caches, so this one lives
 * under a different name that the worker never touches.
 */
const MODEL_CACHE = "songtonotes-models-v1";

const PREPARING = "מכין את ההפרדה…";
const NETWORK_MESSAGE =
  "לא הצלחנו לטעון את ההפרדה המלאה. בדוק את החיבור לאינטרנט ונסה שוב.";
const UNAVAILABLE_MESSAGE = "ההפרדה המלאה אינה זמינה כרגע. נסה שוב מאוחר יותר.";
const INCOMPLETE_MESSAGE = "הטעינה לא הושלמה. נסה שוב עם חיבור יציב.";
const GENERIC_MESSAGE =
  "ההפרדה לא הושלמה. כדאי לנסות שוב ולהשאיר את הכרטיסייה פתוחה בזמן העיבוד.";

/** How long after a tool opens the background prefetch begins, clear of the tool's own loading. */
const PREFETCH_DELAY_MS = 1500;

type ProgressListener = (update: SeparationProgress) => void;

let processorPromise: Promise<import("demucs-web").DemucsProcessor> | null = null;

/**
 * The one transfer of the model in flight, whoever started it. A click during
 * the background prefetch joins it — and gets its progress — rather than
 * starting a second 180MB download beside it.
 */
let transfer: { promise: Promise<boolean>; listeners: Set<ProgressListener> } | null = null;

/** Set once a tool has asked for the prefetch; a failed one is not retried. */
let prefetchArmed = false;

/** The sentence to show for whatever the separator threw. */
export function describeSeparationError(error: unknown): string {
  console.error(error);
  if (error instanceof SeparationError) return error.message;
  // A runtime chunk that cannot be fetched is the same connection problem as
  // a model that cannot be fetched, and deserves the same advice.
  if (error instanceof TypeError && /fetch|import/i.test(error.message)) {
    return NETWORK_MESSAGE;
  }
  return GENERIC_MESSAGE;
}

async function openModelCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(MODEL_CACHE);
  } catch {
    // Private browsing or a locked-down browser: the model still loads, it is
    // just fetched again next time.
    return null;
  }
}

async function readCached(cache: Cache): Promise<ArrayBuffer | null> {
  const stored = await cache.match(SITE_MODEL_URL).catch(() => undefined);
  if (!stored) return null;
  const buffer = await stored.arrayBuffer();
  // A connection that was cut while Cache Storage was writing used to leave
  // a short file behind. Every later click then retried the same corrupt
  // model and looked like a permanently broken AI button. Reject and remove
  // anything whose size differs from the build's known model.
  if (!buffer.byteLength || (SITE_MODEL_BYTES > 0 && buffer.byteLength !== SITE_MODEL_BYTES)) {
    await cache.delete(SITE_MODEL_URL).catch(() => false);
    return null;
  }
  return buffer;
}

/**
 * Fetches the model from one location. `null` means it is not there — a
 * missing file, or a filtered/login page served in its place, which would
 * otherwise reach ONNX as HTML and fail with a message nobody can act on.
 */
async function fetchModelFrom(url: string): Promise<Response | null> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new SeparationError(NETWORK_MESSAGE, { cause: error });
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || /text\/html/i.test(type)) {
    return null;
  }
  return response;
}

/** The site's own copy first; the upstream URL only for a build made without it. */
async function openModelResponse(): Promise<{ response: Response; expectedBytes: number }> {
  let response = await fetchModelFrom(SITE_MODEL_URL);
  let expectedBytes = SITE_MODEL_BYTES;
  if (!response) {
    const demucs = await import("demucs-web");
    response = await fetchModelFrom(demucs.CONSTANTS.DEFAULT_MODEL_URL);
    expectedBytes = 0;
  }
  if (!response) {
    throw new SeparationError(UNAVAILABLE_MESSAGE);
  }
  return { response, expectedBytes };
}

/**
 * Streams a response to its end, reporting how far along it is. With `keep`
 * the bytes are gathered and returned; without it they are counted and
 * dropped, which is all that is needed while a clone of the same response is
 * landing in the cache. `expectedBytes` is the size known from the build,
 * used when the server does not say; a server that compresses on the fly
 * reports the compressed size, which the decoded count then overtakes, so the
 * fraction is clamped rather than trusted.
 */
async function drain(
  response: Response,
  expectedBytes: number,
  keep: boolean,
  onProgress: ProgressListener,
): Promise<ArrayBuffer | null> {
  const total = Number(response.headers.get("content-length")) || expectedBytes;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    return keep ? buffer : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      if (keep) chunks.push(value);
      loaded += value.byteLength;
      const fraction = total ? Math.min(1, loaded / total) : 0;
      onProgress({
        phase: "model",
        progress: fraction,
        message: total
          ? `מכין את ההפרדה בפעם הראשונה… ${Math.round(fraction * 100)}%`
          : "מכין את ההפרדה בפעם הראשונה…",
      });
    }
  }
  if (total && loaded < total) {
    throw new SeparationError(INCOMPLETE_MESSAGE);
  }
  if (!keep) return null;
  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

/**
 * Puts the model into the cache, sharing one transfer between a prefetch and
 * a click. Resolves true once the cached copy is in place, false when the
 * cache would not take it (a full quota), and rejects when the transfer
 * itself failed.
 */
function fillCache(cache: Cache, onProgress?: ProgressListener): Promise<boolean> {
  if (!transfer) {
    const listeners = new Set<ProgressListener>();
    const report: ProgressListener = (update) => {
      for (const listener of listeners) listener(update);
    };
    const promise = (async () => {
      const { response, expectedBytes } = await openModelResponse();
      // The copy for next time is written as the bytes stream past, so it
      // costs no second pass over 180MB and no 180MB held in memory.
      const stored = cache.put(SITE_MODEL_URL, response.clone()).then(
        () => true,
        () => false,
      );
      await drain(response, expectedBytes, false, report);
      return stored;
    })().finally(() => {
      transfer = null;
    });
    transfer = { promise, listeners };
  }
  if (onProgress) transfer.listeners.add(onProgress);
  return transfer.promise;
}

async function loadModelWeights(onProgress: ProgressListener): Promise<ArrayBuffer> {
  onProgress({ phase: "model", progress: 0, message: PREPARING });
  const cache = await openModelCache();
  if (cache) {
    const cached = await readCached(cache);
    if (cached) return cached;
    if (await fillCache(cache, onProgress)) {
      const fresh = await readCached(cache);
      if (fresh) return fresh;
    }
  }

  // No usable cache: the plain download, straight into memory.
  const { response, expectedBytes } = await openModelResponse();
  const buffer = await drain(response, expectedBytes, true, onProgress);
  if (!buffer?.byteLength) {
    throw new SeparationError(UNAVAILABLE_MESSAGE);
  }
  return buffer;
}

/**
 * Whether pulling 180MB nobody has asked for yet is acceptable here. A link
 * the browser reports as metered says no; where the browser will not say, a
 * touch-only device is assumed to be on one and a desktop is not.
 */
function connectionAllowsPrefetch(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }
  ).connection;
  if (connection?.saveData) return false;
  const type = connection?.type;
  if (type && type !== "unknown" && type !== "other") {
    return type === "wifi" || type === "ethernet";
  }
  return !window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

/**
 * Starts pulling the model into the cache before anyone asks for it, so the
 * button answers at once instead of after a long first wait. A tool that
 * offers the separation calls this when it opens. Silent about everything:
 * a failure here only means the click fetches the model as it always did.
 */
export function prefetchSeparationModel(): void {
  if (prefetchArmed || typeof caches === "undefined") return;
  if (!connectionAllowsPrefetch()) return;
  prefetchArmed = true;
  window.setTimeout(() => {
    void (async () => {
      const cache = await openModelCache();
      if (!cache || (await readCached(cache))) return;
      await fillCache(cache);
    })().catch(() => undefined);
  }, PREFETCH_DELAY_MS);
}

async function resampleStereo(buffer: AudioBuffer) {
  const frameCount = Math.max(1, Math.ceil(buffer.duration * MODEL_SAMPLE_RATE));
  const offline = new OfflineAudioContext(2, frameCount, MODEL_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0).slice();
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1).slice() : left.slice();
  return { left, right };
}

function sumInstrumental(result: DemucsResult): [Float32Array, Float32Array] {
  const tracks: DemucsStem[] = [result.drums, result.bass, result.other];
  const length = result.vocals.left.length;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const track of tracks) {
    for (let index = 0; index < length; index += 1) {
      left[index] += track.left[index] ?? 0;
      right[index] += track.right[index] ?? 0;
    }
  }
  return [left, right];
}

async function getProcessor(onProgress: (update: SeparationProgress) => void) {
  if (!processorPromise) {
    processorPromise = (async () => {
      const [ort, demucs, model] = await Promise.all([
        import("onnxruntime-web"),
        import("demucs-web"),
        loadModelWeights(onProgress),
      ]);
      ort.env.wasm.numThreads = 1;
      onProgress({ phase: "model", progress: 1, message: "כמעט מוכן…" });
      const makeProcessor = (executionProviders: string[]) =>
        new demucs.DemucsProcessor({
          ort,
          sessionOptions: {
            executionProviders,
            graphOptimizationLevel: "all",
            enableCpuMemArena: false,
            enableMemPattern: false,
          },
        });

      // WebGPU is faster but some phones expose it without supporting the
      // operators used by the network. Retry with WebAssembly using the
      // weights already in hand instead of leaving the user with a dead
      // button — quietly, because which engine ran is not the visitor's
      // concern.
      if ("gpu" in navigator) {
        try {
          const processor = makeProcessor(["webgpu"]);
          await processor.loadModel(model);
          return processor;
        } catch (error) {
          console.warn("WebGPU separation unavailable, using WebAssembly", error);
        }
      }
      const processor = makeProcessor(["wasm"]);
      await processor.loadModel(model);
      return processor;
    })().catch((error) => {
      processorPromise = null;
      throw error;
    });
  }
  return processorPromise;
}

export async function separateStems(
  buffer: AudioBuffer,
  onProgress: (update: SeparationProgress) => void,
): Promise<SeparatedStems> {
  onProgress({ phase: "model", progress: 0, message: PREPARING });
  const processor = await getProcessor(onProgress);
  const { left, right } = await resampleStereo(buffer);
  processor.onProgress = ({ progress }) => {
    onProgress({
      phase: "separation",
      progress,
      message: `מפריד את השיר… ${Math.round(progress * 100)}%`,
    });
  };
  const result = await processor.separate(left, right);
  return {
    vocals: [result.vocals.left, result.vocals.right],
    instrumental: sumInstrumental(result),
    sampleRate: MODEL_SAMPLE_RATE,
  };
}
