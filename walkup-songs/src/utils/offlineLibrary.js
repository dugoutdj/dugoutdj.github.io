// Offline song library — IndexedDB-backed storage for locally saved audio.
//
// Songs are keyed by YouTube videoId, so a song shared by multiple players is
// downloaded once and reused by all of them.
//
// IndexedDB (not localStorage) is used because audio blobs are megabytes and
// localStorage is capped at ~5 MB and only stores strings.

const DB_NAME = 'dugoutdj-offline';
const DB_VERSION = 1;
const STORE = 'songs';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not supported in this browser'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'videoId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// --- In-memory blob-URL cache ---------------------------------------------
// Keeps a small number of recently played songs' object URLs alive so that
// playback can start *synchronously* inside the user's tap gesture. This
// matters on iOS Safari, where calling audio.play() after an `await` can be
// rejected for lacking a user gesture.

const urlCache = new Map(); // videoId -> { url, blob, trimmed }
const URL_CACHE_MAX = 8;

export function cacheBlobUrl(videoId, blob, trimmed = false) {
  const existing = urlCache.get(videoId);
  if (existing) {
    // Refresh LRU order.
    urlCache.delete(videoId);
    urlCache.set(videoId, existing);
    return existing.url;
  }

  const url = URL.createObjectURL(blob);
  urlCache.set(videoId, { url, blob, trimmed });

  if (urlCache.size > URL_CACHE_MAX) {
    const oldestKey = urlCache.keys().next().value;
    const oldest = urlCache.get(oldestKey);
    URL.revokeObjectURL(oldest.url);
    urlCache.delete(oldestKey);
  }

  return url;
}

export function getCachedUrl(videoId) {
  const entry = urlCache.get(videoId);
  if (!entry) return null;
  // Refresh LRU order.
  urlCache.delete(videoId);
  urlCache.set(videoId, entry);
  return entry.url;
}

export function urlCacheEntry(videoId) {
  return urlCache.get(videoId) || null;
}

export function revokeCachedUrl(videoId) {
  const entry = urlCache.get(videoId);
  if (!entry) return;
  URL.revokeObjectURL(entry.url);
  urlCache.delete(videoId);
}

// --- CRUD ------------------------------------------------------------------

export async function saveSong(record) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(record);
  await transactionDone(tx);
}

export async function getSong(videoId) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const record = await requestToPromise(tx.objectStore(STORE).get(videoId));
  return record || null;
}

export async function removeSong(videoId) {
  revokeCachedUrl(videoId);
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(videoId);
  await transactionDone(tx);
}

export async function listSongs() {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const records = await requestToPromise(tx.objectStore(STORE).getAll());
  return records || [];
}

export async function clearLibrary() {
  for (const key of [...urlCache.keys()]) revokeCachedUrl(key);
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await transactionDone(tx);
}

export async function getUsageBytes() {
  const songs = await listSongs();
  return songs.reduce((sum, song) => sum + (song.size || 0), 0);
}
