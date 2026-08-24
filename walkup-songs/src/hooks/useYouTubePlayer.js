import { useState, useEffect, useRef, useCallback } from 'react';
import { loadYouTubeAPI } from '../utils/youtube';
import { songKey } from '../utils/song';
import {
  getSong,
  getCachedUrl,
  cacheBlobUrl,
  urlCacheEntry
} from '../utils/offlineLibrary';

export const useYouTubePlayer = () => {
  const [player, setPlayer] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isOffline, setIsOffline] = useState(false);
  const playerRef = useRef(null);
  const audioRef = useRef(null);
  const modeRef = useRef('yt'); // 'yt' | 'audio' (audio = Apple preview or saved blob)
  const intervalRef = useRef(null);
  const fadeIntervalRef = useRef(null);
  const playbackEndTimeRef = useRef(null);
  const onSongEndRef = useRef(null);
  const preloadedVideoIdRef = useRef(null);
  const playTokenRef = useRef(0);

  useEffect(() => {
    // Hidden <audio> element used for locally saved (offline) playback.
    const audio = document.createElement('audio');
    audio.style.display = 'none';
    audio.preload = 'auto';
    document.body.appendChild(audio);
    audioRef.current = audio;

    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));
    audio.addEventListener('ended', () => setIsPlaying(false));

    loadYouTubeAPI().then((YT) => {
      new YT.Player('youtube-player', {
        height: '0',
        width: '0',
        playerVars: {
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          playsinline: 1
        },
        events: {
          onReady: (event) => {
            playerRef.current = event.target;
            setPlayer(event.target);
            setIsReady(true);
          },
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.PLAYING) {
              setIsPlaying(true);
            } else if (event.data === YT.PlayerState.PAUSED ||
                       event.data === YT.PlayerState.ENDED) {
              setIsPlaying(false);
            }
          }
        }
      });
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
      audio.pause();
      audio.remove();
      audioRef.current = null;
    };
  }, []);

  // Volume helpers that work for both the YouTube player (0-100) and the
  // hidden audio element (0-1). Mutations go through module-scope helpers so
  // the React Compiler lint rule (react-hooks/immutability) stays satisfied.
  const setTargetVolume = useCallback((value) => {
    if (modeRef.current === 'audio') {
      const audio = audioRef.current;
      if (audio) audio.volume = Math.max(0, Math.min(1, value / 100));
    } else if (player && typeof player.setVolume === 'function') {
      player.setVolume(Math.max(0, Math.min(100, value)));
    }
  }, [player]);

  const getTargetVolume = useCallback(() => {
    if (modeRef.current === 'audio') {
      const audio = audioRef.current;
      return audio ? Math.round((audio.volume || 0) * 100) : 0;
    }
    return (player && typeof player.getVolume === 'function') ? player.getVolume() : 0;
  }, [player]);

  const fadeIn = useCallback((callback) => {
    if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);

    let volume = 0;
    setTargetVolume(volume);

    fadeIntervalRef.current = setInterval(() => {
      volume += 5;
      if (volume >= 100) {
        volume = 100;
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
        if (callback) callback();
      }
      setTargetVolume(volume);
    }, 50);
  }, [setTargetVolume]);

  const fadeOut = useCallback((callback) => {
    if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);

    let volume = getTargetVolume();

    fadeIntervalRef.current = setInterval(() => {
      volume -= 5;
      if (volume <= 0) {
        volume = 0;
        setTargetVolume(volume);
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
        if (callback) callback();
      } else {
        setTargetVolume(volume);
      }
    }, 50);
  }, [getTargetVolume, setTargetVolume]);

  // Monitor playback time and stop the song at startTime + duration.
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        let time = 0;
        if (modeRef.current === 'audio') {
          time = audioRef.current ? audioRef.current.currentTime : 0;
        } else {
          try {
            time = player.getCurrentTime();
          } catch {
            time = 0;
          }
        }
        setCurrentTime(time);

        if (playbackEndTimeRef.current && time >= playbackEndTimeRef.current) {
          fadeOut(() => {
            if (modeRef.current === 'audio') {
              audioRef.current?.pause();
            } else {
              player.pauseVideo();
            }
            if (onSongEndRef.current) {
              onSongEndRef.current();
            }
          });
        }
      }, 100);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, player, fadeOut]);

  const preloadSong = useCallback((videoId, startTime = 0) => {
    if (!player || !isReady || !videoId) return;

    // Only preload if it's a different video than what's already preloaded
    if (preloadedVideoIdRef.current === videoId) return;

    try {
      // Use cueVideoById to buffer the video without playing
      player.cueVideoById({
        videoId,
        startSeconds: startTime
      });
      preloadedVideoIdRef.current = videoId;
    } catch (error) {
      console.warn('Failed to preload video:', error);
    }
  }, [player, isReady]);

  // Play a player's song. `song` is the player object; its source can be
  // Apple Music (songSource 'apple' + previewUrl) or a legacy YouTube video
  // (songVideoId). Saved copies always win; Apple songs stream the same
  // 30-second preview they'd otherwise save.
  const playSong = useCallback((song, startTime = 0, duration = 30, onEnd) => {
    const token = ++playTokenRef.current;
    onSongEndRef.current = onEnd;
    playbackEndTimeRef.current = startTime + duration;

    const key = songKey(song);
    const audio = audioRef.current;
    if (!key) return;

    // Legacy path: play through the (hidden) YouTube player.
    const startYouTube = (id, startSec) => {
      if (token !== playTokenRef.current) return;
      modeRef.current = 'yt';
      setIsOffline(false);
      audio?.pause();
      if (!player || !isReady) return;

      player.setVolume(100);
      player.cueVideoById({
        videoId: id,
        startSeconds: startSec
      });
      setTimeout(() => {
        if (player && player.playVideo && token === playTokenRef.current) {
          player.playVideo();
        }
      }, 200);
    };

    // Audio-element path: plays either a saved blob (`saved` true) or a
    // streamed Apple preview URL (`saved` false). Trimmed saved clips play
    // from 0:00; legacy full-preview blobs start at the window's startTime.
    const startAudio = (url, saved, startAt = startTime) => {
      if (token !== playTokenRef.current) return;
      modeRef.current = 'audio';
      setIsOffline(!!saved);
      // Make sure a previously playing YouTube video goes quiet.
      try { player?.pauseVideo(); } catch { /* ignore */ }
      if (!audio) {
        if (song.songVideoId) startYouTube(song.songVideoId, startTime);
        return;
      }
      audio.src = url;
      audio.currentTime = startAt;
      audio.volume = 0;
      const playPromise = audio.play();
      if (playPromise && playPromise.catch) playPromise.catch(() => {});
      fadeIn();
    };

    // Prefer a locally saved copy. The in-memory URL cache lets us start
    // synchronously inside the user's tap (important on iOS). The cache entry
    // remembers whether the clip was trimmed to the window.
    const cachedUrl = getCachedUrl(key);
    if (audio && cachedUrl) {
      const cached = urlCacheEntry(key);
      startAudio(cachedUrl, true, cached && cached.trimmed ? 0 : startTime);
      return;
    }

    // Apple songs: kick off streaming immediately (keeps the user gesture for
    // iOS), while checking for a saved copy to prefer it.
    if (song.songSource === 'apple' && song.previewUrl && audio) {
      audio.src = song.previewUrl; // start buffering inside the tap
      getSong(key)
        .then((saved) => {
          if (token !== playTokenRef.current) return;
          if (saved && saved.blob) {
            startAudio(cacheBlobUrl(key, saved.blob, !!saved.trimmed), true, saved.trimmed ? 0 : startTime);
          } else {
            startAudio(song.previewUrl, false, startTime);
          }
        })
        .catch(() => {
          if (token !== playTokenRef.current) return;
          startAudio(song.previewUrl, false, startTime);
        });
      return;
    }

    // Legacy YouTube path: check IndexedDB; if nothing is saved, stream.
    getSong(key)
      .then((saved) => {
        if (token !== playTokenRef.current) return;
        if (saved && saved.blob && audio) {
          startAudio(cacheBlobUrl(key, saved.blob, !!saved.trimmed), true, saved.trimmed ? 0 : startTime);
        } else if (song.songVideoId) {
          startYouTube(song.songVideoId, startTime);
        }
      })
      .catch(() => {
        if (token !== playTokenRef.current) return;
        if (song.songVideoId) startYouTube(song.songVideoId, startTime);
      });
  }, [player, isReady, fadeIn]);

  const pauseSong = useCallback(() => {
    fadeOut(() => {
      if (modeRef.current === 'audio') {
        audioRef.current?.pause();
      } else {
        player.pauseVideo();
      }
    });
  }, [player, fadeOut]);

  const resumeSong = useCallback(() => {
    if (modeRef.current === 'audio') {
      const playPromise = audioRef.current?.play();
      if (playPromise && playPromise.catch) playPromise.catch(() => {});
      fadeIn();
    } else {
      player.playVideo();
      fadeIn();
    }
  }, [player, fadeIn]);

  const stopSong = useCallback(() => {
    fadeOut(() => {
      if (modeRef.current === 'audio') {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
      } else {
        player.stopVideo();
      }
      playbackEndTimeRef.current = null;
      onSongEndRef.current = null;
    });
  }, [player, fadeOut]);

  const setVolume = useCallback((volume) => {
    setTargetVolume(Math.max(0, Math.min(100, volume)));
  }, [setTargetVolume]);

  return {
    isReady,
    isPlaying,
    isOffline,
    currentTime,
    playSong,
    preloadSong,
    pauseSong,
    resumeSong,
    stopSong,
    setVolume
  };
};
