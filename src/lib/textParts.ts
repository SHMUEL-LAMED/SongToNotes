/**
 * Loads a binary the build published as small base64 JSON files (see
 * `binaryAsTextParts` in vite.config.ts). Filtered connections such as NetFree
 * hold back or damage large binary downloads but pass JSON, which is how the
 * site's other replies already reach them.
 */

type Manifest = { bytes: number; parts: string[] };

/** Parts in flight at once: enough to fill the line, few enough to retry cheaply. */
const PARALLEL = 4;
const ATTEMPTS = 3;

function partsBase(name: string) {
  return `${import.meta.env.BASE_URL}parts/${name}/`;
}

/** A JSON body, or null when there is none (a missing file, or a page served in its place). */
async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || /text\/html/i.test(type)) return null;
  return response.json();
}

function isManifest(value: unknown): value is Manifest {
  const manifest = value as Manifest | null;
  return (
    !!manifest &&
    typeof manifest.bytes === "number" &&
    Array.isArray(manifest.parts) &&
    manifest.parts.every((part) => typeof part === "string")
  );
}

/** The manifest for `name`, or null when this build has no parts for it (a dev server). */
export async function readPartsManifest(name: string): Promise<Manifest | null> {
  const manifest = await fetchJson(`${partsBase(name)}manifest.json`, { cache: "no-cache" });
  return isManifest(manifest) ? manifest : null;
}

export function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const native = (Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array<ArrayBuffer> })
    .fromBase64;
  if (native) return native(text);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function fetchPart(url: string): Promise<Uint8Array<ArrayBuffer>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const text = await fetchJson(url);
      if (typeof text !== "string") throw new Error(`Part missing: ${url}`);
      return decodeBase64(text);
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

/**
 * Fetches every part and joins them. `onBytes` hears the running total. The
 * result is a Blob so the parts can be handed to the cache without first
 * being copied into one large block of memory.
 */
export async function downloadParts(
  name: string,
  manifest: Manifest,
  onBytes?: (loaded: number, total: number) => void,
): Promise<Blob> {
  const base = partsBase(name);
  const pieces: Uint8Array<ArrayBuffer>[] = new Array(manifest.parts.length);
  let loaded = 0;
  let next = 0;
  const worker = async () => {
    while (next < manifest.parts.length) {
      const index = next;
      next += 1;
      const bytes = await fetchPart(base + manifest.parts[index]);
      pieces[index] = bytes;
      loaded += bytes.byteLength;
      onBytes?.(loaded, manifest.bytes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, manifest.parts.length) }, worker));
  const blob = new Blob(pieces);
  if (blob.size !== manifest.bytes) {
    throw new Error(`Assembled ${blob.size} of ${manifest.bytes} bytes for ${name}`);
  }
  return blob;
}
