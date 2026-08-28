// Shared helpers for a player's song. A player can have either:
//   - an Apple Music track (songSource: 'apple', with appleTrackId/previewUrl),
//     or
//   - a legacy YouTube video (songVideoId).
// `songKey` is the stable identifier used for offline storage and playback
// lookups. Apple keys are prefixed so they can never collide with a video ID.

// Apple artwork is proxied through dugoutdj.com so mobile clients (which
// are blocked from mzstatic.com) can display it.
import { mediaProxy } from './media';

export function songKey(player) {
  if (!player) return null;
  if (player.songSource === 'apple') {
    return player.appleTrackId ? `apple:${player.appleTrackId}` : null;
  }
  // Treat a video id as a YouTube song even when older shared records have
  // an empty or inconsistent songSource value.
  return player.songVideoId || null;
}

export function playerHasSong(player) {
  return !!songKey(player);
}

// Artwork to show for a player: Apple artwork (upgraded to 600x600) or the
// legacy YouTube thumbnail.
export function playerArtwork(player) {
  if (!player) return null;
  if (player.songSource === 'apple' && player.artworkUrl) {
    return mediaProxy(String(player.artworkUrl).replace('100x100', '600x600'));
  }
  return player.songThumbnail || null;
}
