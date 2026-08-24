// Offline saves and song lookup via Apple's public iTunes Search API.
//
// Walk-up songs are 15-30 second clips, and Apple's catalog exposes exactly
// that: official 30-second audio previews served from its CDN. Both the
// search API (itunes.apple.com) and the audio host (audio-ssl.itunes.apple.com)
// send `Access-Control-Allow-Origin: *`, so everything runs in the browser —
// no backend, no API key, and no YouTube bot detection. The preview URL is
// also the streaming source, so a saved song and a streamed song are the same
// audio.

// Same-origin proxy (Cloudflare Pages Function) so mobile clients never
// hit itunes.apple.com directly — iOS WebKit in particular fails those
// requests from phones. Falls back to Apple's API directly when the proxy
// isn't available (local dev / previews without Functions).
const SEARCH_URL = '/api/search';
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const SEARCH_LIMIT = 8;

// Strip YouTube-style video-title noise so "Artist - Song (Official Video)
// (4K Remaster)" searches as "Artist - Song".
export function cleanTitle(title) {
  return String(title || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ') // (Official Video), (4K), (Lyrics), ...
    .replace(/\s*\[[^\]]*\]\s*/g, ' ') // [Official Audio], ...
    .replace(/\s*[-–—]\s*Topic$/i, '') // auto-generated topic channels
    .replace(/[|•:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Live search for the Add Player form. Returns the raw top matches so the
 * user can pick the exact recording.
 */
function mapResults(data) {
  return (data.results || [])
    .filter((r) => r.previewUrl)
    .map((r) => ({
      trackId: r.trackId,
      trackName: r.trackName,
      artistName: r.artistName,
      collectionName: r.collectionName,
      artworkUrl: r.artworkUrl100 || null,
      previewUrl: r.previewUrl,
      trackViewUrl: r.trackViewUrl || null
    }));
}

export async function searchTracks(query) {
  const term = cleanTitle(query);
  if (!term) return [];

  // Primary: same-origin proxy. On the deployed site this always works and
  // benefits from edge caching.
  try {
    const res = await fetch(`${SEARCH_URL}?term=${encodeURIComponent(term)}&limit=${SEARCH_LIMIT}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.results)) return mapResults(data);
    }
  } catch {
    // Proxy unavailable — fall through to Apple directly.
  }

  const direct = await fetch(
    `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${SEARCH_LIMIT}`
  );
  if (!direct.ok) {
    throw new Error(`Apple's search API failed (HTTP ${direct.status}).`);
  }
  return mapResults(await direct.json());
}

// Score iTunes results against the cleaned title: count matching significant
// words (track + artist), and strongly prefer an exact track-name match.
function pickBest(results, cleaned) {
  const words = cleaned
    .toLowerCase()
    .split(' ')
    .filter((w) => w.length > 2);
  const exact = cleaned.toLowerCase();

  let best = null;
  let bestScore = -1;
  for (const r of results) {
    const track = (r.trackName || '').toLowerCase();
    const artist = (r.artistName || '').toLowerCase();
    const hay = `${track} ${artist}`;
    let score = 0;
    for (const w of words) {
      if (hay.includes(w)) score += 1;
    }
    if (track === exact) score += 10;
    if (track.includes(exact) || exact.includes(track)) score += 3;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Best single match for a title (used for legacy YouTube-sourced players,
 * which only have a video title).
 */
export async function searchPreview(title) {
  const results = await searchTracks(title);
  return pickBest(results, cleanTitle(title)) || null;
}

async function fetchPreviewBlob(previewUrl, onProgress) {
  onProgress?.({ stage: 'downloading', downloaded: 0, total: 0 });
  const res = await fetch(previewUrl);
  if (!res.ok) {
    throw new Error(`Preview download failed (HTTP ${res.status}).`);
  }

  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let downloaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    if (total) onProgress?.({ stage: 'downloading', downloaded, total });
  }

  return new Blob(chunks, { type: 'audio/mp4' });
}

// 16-bit PCM WAV encoder — the browser can decode audio (AudioContext) but
// not encode AAC/MP4, so the trimmed clip is re-encoded as WAV.
function encodeWav(buffer) {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = frames * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Cut a [start, start+duration) window out of a decoded AudioBuffer.
 */
function sliceBuffer(buffer, startSeconds, durationSeconds) {
  const sampleRate = buffer.sampleRate;
  const totalFrames = buffer.length;
  const startFrame = Math.max(0, Math.min(totalFrames, Math.floor(startSeconds * sampleRate)));
  const endFrame = Math.max(
    startFrame,
    Math.min(totalFrames, Math.floor((startSeconds + durationSeconds) * sampleRate))
  );
  const frames = endFrame - startFrame;

  const sliced = new AudioBuffer({
    length: frames,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate
  });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    sliced.copyToChannel(buffer.getChannelData(c).subarray(startFrame, endFrame), c);
  }
  return sliced;
}

/**
 * Trim an audio blob to the player's walk-up window.
 *
 * The Apple preview is 30 seconds; the walk-up clip is a 10-second slice the
 * user picks. Decoding through the Web Audio API and re-encoding as WAV gives
 * an exact, self-contained clip that plays from 0:00 — identical offline and
 * streamed. Falls back to the untrimmed blob when the browser can't decode.
 *
 * @returns {Promise<{ blob: Blob, mimeType: string, trimmed: boolean }>}
 */
async function trimToWindow(blob, startTime, duration) {
  const start = Math.max(0, Number(startTime) || 0);
  const dur = Math.max(1, Number(duration) || 0);

  // Only trim when there's an actual window to cut.
  if (start === 0 && !dur) return { blob, mimeType: blob.type || 'audio/mp4', trimmed: false };

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return { blob, mimeType: blob.type || 'audio/mp4', trimmed: false };
    const ctx = new Ctx();
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      const sliced = sliceBuffer(decoded, start, dur);
      const wav = encodeWav(sliced);
      await ctx.close();
      return { blob: wav, mimeType: 'audio/wav', trimmed: true };
    } catch (err) {
      console.warn('Audio trim failed, saving untrimmed preview:', err);
      try { await ctx.close(); } catch { /* ignore */ }
      return { blob, mimeType: blob.type || 'audio/mp4', trimmed: false };
    }
  } catch (err) {
    console.warn('AudioContext unavailable, saving untrimmed preview:', err);
    return { blob, mimeType: blob.type || 'audio/mp4', trimmed: false };
  }
}

/**
 * Download a song's preview and cut it to the player's walk-up window.
 *
 * @param {string} key stable song identifier (see utils/song.js)
 * @param {string} title song title (used only when previewUrl is missing)
 * @param {string|null} previewUrl known Apple preview URL — skips the search
 * @param {number} [startTime] window start inside the preview (seconds)
 * @param {number} [duration] window length (seconds)
 * @param {(progress: object) => void} [onProgress]
 *   Receives { stage: 'searching' } and { stage: 'downloading', downloaded, total }.
 * @returns {Promise<{ blob: Blob, mimeType: string, title: string, trimmed: boolean }>}
 */
export async function downloadPreview(key, title, previewUrl, startTime = 0, duration = 0, onProgress) {
  let match = null;

  if (previewUrl) {
    match = { previewUrl };
  } else {
    onProgress?.({ stage: 'searching' });
    const found = await searchPreview(title);
    if (!found) {
      throw new Error(
        `Couldn't find "${cleanTitle(title) || title}" in the Apple Music catalog — check the song title on the player, or edit the song to pick it from the search.`
      );
    }
    match = found;
  }

  const fullBlob = await fetchPreviewBlob(match.previewUrl, onProgress);
  const { blob, mimeType, trimmed } = await trimToWindow(fullBlob, startTime, duration);
  return {
    blob,
    mimeType,
    trimmed,
    title: match.trackName ? `${match.artistName} - ${match.trackName}` : title
  };
}
