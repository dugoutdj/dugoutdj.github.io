/**
 * GameChanger API utilities for fetching team and roster data
 */

const GC_API_BASE = 'https://api.team-manager.gc.com';

/**
 * Fetch team information from GameChanger
 * @param {string} teamId - The GameChanger team ID
 * @param {string} token - The GC authentication token
 * @returns {Promise<Object>} Team data
 */
export async function fetchTeamInfo(teamId, token) {
  const url = `${GC_API_BASE}/public/teams/${teamId}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch team info: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Fetch team roster from GameChanger
 * @param {string} teamId - The GameChanger team ID
 * @param {string} token - The GC authentication token
 * @returns {Promise<Array>} Array of players
 */
export async function fetchTeamRoster(teamId, token) {
  // Try multiple potential endpoints
  const endpoints = [
    `${GC_API_BASE}/teams/${teamId}/players`,
    `${GC_API_BASE}/teams/${teamId}/roster`,
    `${GC_API_BASE}/public/teams/${teamId}/roster`,
    `${GC_API_BASE}/teams/${teamId}/members`
  ];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        // Handle different response formats
        if (Array.isArray(data)) {
          return data;
        } else if (data.players) {
          return data.players;
        } else if (data.roster) {
          return data.roster;
        } else if (data.members) {
          return data.members;
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch from ${url}:`, error);
    }
  }

  throw new Error('Could not fetch roster from any known endpoint');
}

/**
 * Fetch team games to extract lineup/roster information
 * @param {string} teamId - The GameChanger team ID
 * @param {string} token - The GC authentication token
 * @returns {Promise<Array>} Array of players extracted from games
 */
export async function fetchRosterFromGames(teamId, token) {
  const url = `${GC_API_BASE}/public/teams/${teamId}/games`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch games: ${response.status}`);
    }

    const games = await response.json();

    // Extract unique players from game lineups
    const playersMap = new Map();

    if (Array.isArray(games)) {
      games.forEach(game => {
        // Look for lineup data in various places
        const lineup = game.lineup || game.home_lineup || game.away_lineup || [];

        lineup.forEach(player => {
          if (player.id && !playersMap.has(player.id)) {
            playersMap.set(player.id, {
              id: player.id,
              first_name: player.first_name || player.firstName || '',
              last_name: player.last_name || player.lastName || '',
              number: player.number || player.jersey_number || '',
              position: player.position || ''
            });
          }
        });
      });
    }

    return Array.from(playersMap.values());
  } catch (error) {
    console.warn('Could not fetch roster from games:', error);
    return [];
  }
}

/**
 * Import team and roster from GameChanger
 * @param {string} teamId - The GameChanger team ID
 * @param {string} token - The GC authentication token
 * @returns {Promise<Object>} Object with team and players data
 */
export async function importFromGameChanger(teamId, token) {
  try {
    // Fetch team info
    const teamInfo = await fetchTeamInfo(teamId, token);

    // Try to fetch roster
    let players = [];

    try {
      players = await fetchTeamRoster(teamId, token);
    } catch (error) {
      console.warn('Direct roster fetch failed, trying games endpoint:', error);
      players = await fetchRosterFromGames(teamId, token);
    }

    // Transform to Dugout DJ format
    const team = {
      id: Date.now(),
      name: teamInfo.name || 'Imported Team',
      gcTeamId: teamId,
      players: players.map((player, index) => ({
        id: Date.now() + index + 1,
        name: `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Unknown Player',
        number: String(player.number || ''),
        gcPlayerId: player.id,
        songUrl: '',
        songVideoId: '',
        songTitle: '',
        songThumbnail: '',
        startTime: 0,
        duration: 20,
        order: index
      }))
    };

    return team;
  } catch (error) {
    console.error('GameChanger import error:', error);
    throw new Error(`Failed to import from GameChanger: ${error.message}`);
  }
}

/**
 * Extract team ID from GameChanger URL
 * @param {string} url - GameChanger team URL
 * @returns {string|null} Team ID or null
 */
export function extractTeamIdFromUrl(url) {
  const match = url.match(/teams\/([^\/\?]+)/);
  return match ? match[1] : null;
}
