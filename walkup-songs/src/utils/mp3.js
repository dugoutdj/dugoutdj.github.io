// Client helpers for the "Upload an MP3" song source.
//
// The user picks an audio file; the form reads its duration (so the walk-up
// window slider can span the whole song), trims the chosen 5-15 second
// window client-side on Save, and uploads ONLY that tiny clip to R2 via
// /api/audio. Playback then streams the clip from dugoutdj.com and the
// coach's device caches it into the offline library like every other song.
// The full uploaded file never leaves the device.

export function clipUrl(key) {
  if (!key) return null;
  return `/api/audio/${encodeURIComponent(key)}`;
}

// Fetch a stored clip and return its blob. The clip is already trimmed to
// the walk-up window, so it plays from 0:00.
export async function fetchClip(key) {
  const res = await fetch(clipUrl(key));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Clip download failed (HTTP ${res.status}).`);
  }
  return {
    blob: await res.blob(),
    mimeType: res.headers.get('Content-Type') || 'audio/wav'
  };
}

// Decode an uploaded audio file and return its length in seconds. Used by
// the form to size the walk-up window slider over the full song.
export async function readAudioDuration(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('Audio decoding is not supported in this browser');
  const ctx = new Ctx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    return decoded.duration || 0;
  } finally {
    try { await ctx.close(); } catch { /* ignore */ }
  }
}

// Upload the already-trimmed walk-up clip. Returns the R2 object key.
export async function uploadClip(blob) {
  const form = new FormData();
  form.append('file', blob, 'clip.wav');
  const res = await fetch('/api/audio', { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Upload failed (HTTP ${res.status}).`);
  }
  return body;
}

// Best-effort removal of a stored clip (player deleted, song replaced).
export async function deleteClip(key) {
  if (!key) return;
  try {
    await fetch(`/api/audio?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch { /* best effort */ }
}
