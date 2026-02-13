// Utility functions for encoding/decoding player song update codes

const CODE_PREFIX = 'DJU'; // Dugout DJ Update

/**
 * Generate an update code from player and song data
 * Format: DJU:playerID:videoID:startTime:duration
 */
export function generateUpdateCode(playerId, videoId, startTime, duration) {
  return `${CODE_PREFIX}:${playerId}:${videoId}:${startTime}:${duration}`;
}

/**
 * Parse an update code into its components
 * Returns null if code is invalid
 */
export function parseUpdateCode(code) {
  if (!code || typeof code !== 'string') {
    return null;
  }

  const parts = code.trim().split(':');

  if (parts.length !== 5) {
    return null;
  }

  const [prefix, playerId, videoId, startTime, duration] = parts;

  // Validate prefix
  if (prefix !== CODE_PREFIX) {
    return null;
  }

  // Validate player ID (should be a number)
  const playerIdNum = parseInt(playerId, 10);
  if (isNaN(playerIdNum)) {
    return null;
  }

  // Validate video ID (should be non-empty string)
  if (!videoId || videoId.length === 0) {
    return null;
  }

  // Validate start time and duration (should be numbers)
  const startTimeNum = parseInt(startTime, 10);
  const durationNum = parseInt(duration, 10);

  if (isNaN(startTimeNum) || isNaN(durationNum)) {
    return null;
  }

  if (startTimeNum < 0 || durationNum <= 0) {
    return null;
  }

  return {
    playerId: playerIdNum,
    videoId,
    startTime: startTimeNum,
    duration: durationNum
  };
}

/**
 * Generate a shareable parent form URL
 */
export function generateParentFormUrl(playerId, playerName, teamId) {
  const baseUrl = window.location.origin;
  const params = new URLSearchParams({
    pid: playerId,
    pn: playerName,
    tid: teamId
  });
  return `${baseUrl}/#/parent?${params.toString()}`;
}
