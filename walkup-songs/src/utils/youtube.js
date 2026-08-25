// YouTube API utility functions

export const extractVideoId = (url) => {
  if (!url) return null;

  // Handle various YouTube URL formats (including YouTube Music)
  const patterns = [
    /(?:youtube\.com\/watch\?v=|music\.youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
};

export const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const parseTime = (timeStr) => {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(p => parseInt(p) || 0);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
};

// Fetch video info from YouTube oEmbed API (no API key required)
export const fetchVideoInfo = async (videoId) => {
  if (!videoId) return null;

  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch video info');
    }

    const data = await response.json();
    return {
      title: data.title || null,
      thumbnail: data.thumbnail_url || null,
      author: data.author_name || null
    };
  } catch (error) {
    console.error('Error fetching video info:', error);
    return null;
  }
};

// Backward compatibility - fetch just the title
export const fetchVideoTitle = async (videoId) => {
  const info = await fetchVideoInfo(videoId);
  return info?.title || null;
};

// Load YouTube IFrame API
export const loadYouTubeAPI = () => {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }

    window.onYouTubeIframeAPIReady = () => {
      resolve(window.YT);
    };

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
  });
};

// Search YouTube videos (using YouTube Data API v3)
export const searchYouTube = async (query, apiKey) => {
  if (!apiKey) {
    // Fallback: return a search URL that opens in new tab
    return {
      type: 'url',
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    };
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=10&q=${encodeURIComponent(query)}&type=video&key=${apiKey}`
    );
    const data = await response.json();

    return {
      type: 'results',
      items: data.items?.map(item => ({
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.default.url,
        channel: item.snippet.channelTitle
      })) || []
    };
  } catch (error) {
    console.error('YouTube search error:', error);
    return {
      type: 'url',
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    };
  }
};

// --- Video duration lookup -------------------------------------------------
// The walk-up window slider needs the video's total length to draw its track.
// The YouTube IFrame API is the only keyless way to read it, so a single
// hidden player is created lazily and reused for all lookups. Results are
// cached so repeated calls are instant.

const durationCache = new Map(); // videoId -> seconds (0 = couldn't read)
let durationPlayerPromise = null; // resolves to a ready YT.Player (or null)

function durationPoll(videoId, player) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (d) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      try { player.removeEventListener('onStateChange', onState); } catch { /* noop */ }
      durationCache.set(videoId, d || 0);
      resolve(d || 0);
    };

    // Reading the position right after cueing can return 0 until the
    // metadata arrives; poll getDuration() and also resolve the moment the
    // player reports CUED (video metadata loaded).
    const check = () => {
      if (!player) return finish(0);
      let d = 0;
      try { d = player.getDuration() || 0; } catch { /* not ready yet */ }
      if (d > 0) finish(d);
    };
    const onState = (e) => {
      // YT.PlayerState.CUED === 5 — metadata is available.
      if (e && e.data === 5) check();
    };

    const poll = setInterval(check, 250);
    const timeout = setTimeout(() => finish(0), 20000);
    try { player.addEventListener('onStateChange', onState); } catch { /* noop */ }
  });
}

// Read the length (in seconds) of a YouTube video. Resolves 0 when the
// length can't be read (offline, bot check, private video).
export function getVideoDuration(videoId) {
  if (!videoId) return Promise.resolve(0);
  if (durationCache.has(videoId)) return Promise.resolve(durationCache.get(videoId));

  return loadYouTubeAPI()
    .then((YT) => {
      if (!durationPlayerPromise) {
        durationPlayerPromise = new Promise((resolve) => {
          let host = document.getElementById('yt-duration-host');
          if (!host) {
            host = document.createElement('div');
            host.id = 'yt-duration-host';
            host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
            document.body.appendChild(host);
          }
          let player = null;
          try {
            player = new YT.Player(host, {
              height: '1',
              width: '1',
              playerVars: { controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1 },
              events: {
                onReady: () => resolve(player),
                onError: () => resolve(null)
              }
            });
          } catch {
            resolve(null);
          }
          // Safety net: if the API never fires onReady, don't hang callers.
          setTimeout(() => resolve(durationPlayerPromise ? null : null), 15000);
        });
      }
      return durationPlayerPromise;
    })
    .then((player) => {
      if (!player) {
        durationCache.set(videoId, 0);
        return 0;
      }
      try {
        player.cueVideoById(videoId);
      } catch {
        durationCache.set(videoId, 0);
        return 0;
      }
      return durationPoll(videoId, player);
    })
    .catch(() => {
      durationCache.set(videoId, 0);
      return 0;
    });
}
