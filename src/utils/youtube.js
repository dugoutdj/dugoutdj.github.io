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
