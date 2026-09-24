/*
 * Offline support for כלי מוזיקה.
 *
 * Every tool already does its work inside the browser, so the only thing
 * standing between the site and a plane ride is the network round trip that
 * fetches the app itself. This worker removes that: the shell is precached on
 * install and hashed build assets are cached the first time they are used.
 *
 * Two deliberate limits:
 *  - HTML is fetched network-first, so a fresh deploy is picked up on the next
 *    load instead of being pinned to whatever shipped first.
 *  - The ONNX runtime WebAssembly binary (~27MB) and anything else oversized is
 *    never stored, because filling the origin's storage quota would evict the
 *    caches that actually matter. The one large file worth keeping — the
 *    vocal-separation model — is stored by the page itself, under a cache
 *    name outside the `musictools-` prefix so the clean-up below leaves it be.
 */

const VERSION = "v4";
const SHELL_CACHE = `musictools-shell-${VERSION}`;
const RUNTIME_CACHE = `musictools-runtime-${VERSION}`;

// Kept small on purpose: everything else is hashed and cached on first use.
const SHELL = ["./", "./index.html", "./favicon.svg", "./manifest.webmanifest", "./icon-192.png"];

/** Responses above this are streamed straight from the network, never stored. */
const MAX_CACHEABLE_BYTES = 12 * 1024 * 1024;

/** Hashed assets add up; keep the runtime cache from growing without bound. */
const MAX_RUNTIME_ENTRIES = 60;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // One failed entry should not fail the whole install.
      Promise.all(
        SHELL.map((path) =>
          cache.add(new Request(path, { cache: "reload" })).catch(() => undefined),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("musictools-") && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

function isOversized(response) {
  const length = Number(response.headers.get("content-length"));
  return Number.isFinite(length) && length > MAX_CACHEABLE_BYTES;
}

function isStorable(url, response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  // The runtime binary alone is larger than the budget for everything else.
  if (/\.wasm$/i.test(url.pathname)) return false;
  return !isOversized(response);
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_RUNTIME_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map((key) => cache.delete(key)));
}

/** HTML: fresh when online, the last good copy when not. */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put("./index.html", response.clone());
    }
    return response;
  } catch (error) {
    const cached = (await caches.match("./index.html")) ?? (await caches.match("./"));
    if (cached) return cached;
    throw error;
  }
}

/** Build assets: instant from cache, refreshed quietly in the background. */
async function handleAsset(request, url) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (isStorable(url, response)) {
        await cache.put(request, response.clone());
        await trim(cache);
      }
      return response;
    })
    .catch((error) => {
      if (cached) return cached;
      throw error;
    });

  return cached ?? network;
}

/*
 * Share target: a song or video shared to the installed app from another app
 * arrives here as a form post. The file is put where the home page looks for
 * it (the same IndexedDB store the tools use for hand-offs) and the visitor
 * lands on the home page, which asks what to do with it. It never leaves the
 * device.
 */
const FILE_DB = "music-tools-files";
const FILE_STORE = "files";
const SHARED_ID = "shared-in";

function storeSharedFile(file) {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(FILE_DB, 1);
    } catch {
      resolve(false);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: "id" });
    };
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const transaction = db.transaction(FILE_STORE, "readwrite");
        transaction.objectStore(FILE_STORE).put({
          id: SHARED_ID,
          name: file.name || "shared-audio",
          type: file.type || "application/octet-stream",
          size: file.size,
          savedAt: new Date().toISOString(),
          blob: file,
        });
        transaction.oncomplete = () => {
          db.close();
          resolve(true);
        };
        transaction.onerror = () => {
          db.close();
          resolve(false);
        };
      } catch {
        db.close();
        resolve(false);
      }
    };
  });
}

async function handleShare(request) {
  const home = new URL("./", self.location.href);
  try {
    const form = await request.formData();
    const file = form.getAll("file").find((item) => item && typeof item === "object" && item.size > 0);
    if (file) await storeSharedFile(file);
  } catch {
    // Land on the home page anyway; the visitor can pick the file there.
  }
  return Response.redirect(home.href, 303);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method === "POST" && new URL(request.url).pathname.endsWith("/share-target")) {
    event.respondWith(handleShare(request));
    return;
  }
  if (request.method !== "GET") return;
  // Range requests back the audio elements; a partial response must not be
  // cached or replayed as if it were the whole file.
  if (request.headers.has("range")) return;

  const url = new URL(request.url);
  // Supabase and the font host stay on the default path — this worker only
  // knows how to reason about its own build output.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL("./", self.location.href).pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAsset(request, url));
});
