/**
 * Fetches the vocal-separation model so the build can ship it with the site.
 *
 * The separation runs entirely in the visitor's browser, so the network's
 * weights have to reach that browser somehow. Rather than send every visitor
 * to a third-party host the moment they press the button, the model is
 * downloaded once here, at build time, and copied into `dist/model` next to
 * the rest of the site (see `vite.config.ts`). At 180MB it is far past what a
 * git repository should carry, so it lives in the git-ignored `models/`
 * folder and is fetched on demand — and cached between CI runs.
 *
 *   node scripts/fetch-separation-model.mjs          # skips when present
 *   node scripts/fetch-separation-model.mjs --force  # downloads again
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { CONSTANTS } from "demucs-web/constants";

const root = fileURLToPath(new URL("..", import.meta.url));
const MODEL_DIR = path.join(root, "models");
const MODEL_FILE = path.join(MODEL_DIR, "htdemucs_embedded.onnx");
const MODEL_URL = CONSTANTS.DEFAULT_MODEL_URL;
const ATTEMPTS = 3;

const force = process.argv.includes("--force");
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const relative = path.relative(process.cwd(), MODEL_FILE);

async function alreadyPresent() {
  try {
    const info = await stat(MODEL_FILE);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** Streams the file to disk, printing coarse progress so CI logs stay short. */
async function download() {
  const response = await fetch(MODEL_URL);
  if (!response.ok || !response.body) {
    throw new Error(`${MODEL_URL} answered ${response.status} ${response.statusText}`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (/text\/html/i.test(type)) {
    throw new Error(`${MODEL_URL} returned a web page instead of the model`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  console.log(`Fetching the separation model${total ? ` (${megabytes(total)})` : ""} → ${relative}`);

  let loaded = 0;
  let reported = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      loaded += chunk.length;
      const step = total ? Math.floor((loaded / total) * 4) : 0;
      if (step > reported) {
        reported = step;
        console.log(`  ${step * 25}%`);
      }
      callback(null, chunk);
    },
  });

  const partial = `${MODEL_FILE}.part`;
  await mkdir(MODEL_DIR, { recursive: true });
  try {
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial));
    if (total && loaded !== total) {
      throw new Error(`download stopped at ${megabytes(loaded)} of ${megabytes(total)}`);
    }
    // Only a complete file ever sits under the final name, so a build that
    // finds one can trust it without re-checking the size.
    await rename(partial, MODEL_FILE);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
  console.log(`Saved ${megabytes(loaded)} to ${relative}`);
}

if (!force && (await alreadyPresent())) {
  console.log(`Separation model already present at ${relative}`);
} else {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      await download();
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt} of ${ATTEMPTS} failed: ${error instanceof Error ? error.message : error}`);
      if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  if (lastError) {
    console.error("Could not fetch the separation model; the site would ship without it.");
    process.exit(1);
  }
}
