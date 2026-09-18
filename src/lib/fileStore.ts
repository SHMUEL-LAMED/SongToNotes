/**
 * The audio a tool produced, kept on this device.
 *
 * The site promises that a song never leaves the browser, and the personal
 * area keeps that promise: what crosses devices is the record of the work —
 * its title, its settings, what it measured — while the karaoke track or the
 * practice version itself is written here, in IndexedDB, on the device that
 * made it. Opening the personal area on that device offers the file to play
 * and download; on another device the card says where the file is.
 *
 * Every call resolves rather than throws when storage is unavailable — a
 * private window, a blocked origin, a browser without IndexedDB — because a
 * missing file is a state the interface already shows, not an error.
 */

const DB_NAME = "music-tools-files";
const STORE = "files";
const VERSION = 1;

export type StoredFileInfo = {
  id: string;
  name: string;
  type: string;
  size: number;
  savedAt: string;
};

type StoredFile = StoredFileInfo & { blob: Blob };

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A version bump from another tab closes this handle; the next call
      // reopens rather than failing forever.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(STORE, mode);
          const request = action(transaction.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Keeps `file` under `id`, replacing whatever was there. Resolves to whether it was written. */
export async function putFile(id: string, file: File | Blob, name?: string): Promise<boolean> {
  const record: StoredFile = {
    id,
    name: name ?? (file instanceof File ? file.name : `${id}.wav`),
    type: file.type || "application/octet-stream",
    size: file.size,
    savedAt: new Date().toISOString(),
    blob: file,
  };
  const result = await run("readwrite", (store) => store.put(record));
  return result !== null;
}

export async function getFile(id: string): Promise<File | null> {
  const record = await run<StoredFile | undefined>("readonly", (store) => store.get(id));
  if (!record?.blob) return null;
  return new File([record.blob], record.name, { type: record.type });
}

export async function deleteFile(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}

/** Every file on this device, without the bytes. */
export async function listFiles(): Promise<StoredFileInfo[]> {
  const records = await run<StoredFile[]>("readonly", (store) => store.getAll());
  if (!records) return [];
  return records.map(({ id, name, type, size, savedAt }) => ({ id, name, type, size, savedAt }));
}

export async function clearFiles(): Promise<void> {
  await run("readwrite", (store) => store.clear());
}
