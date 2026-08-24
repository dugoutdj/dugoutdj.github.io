// Shared helpers for a player's song. A player can have either:
//   - an Apple Music track (songSource: 'apple', with appleTrackId/previewUrl),
//     or
//   - a legacy YouTube video (songVideoId).
// `songKey` is the stable identifier used for offline storage and playback
// lookups. Apple keys are prefixed so they can never collide with a video ID.

export function songKey(player) {
  if (!player) return null;
  if (player.songSource === 'apple') {
    return player.appleTrackId ? `apple:${player.appleTrackId}` : null;
  }
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
    return String(player.artworkUrl).replace('100x100', '600x600');
  }
  return player.songThumbnail || null;
}
