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
  const preloadedStartRef = useRef(null);
  const ytRetryRef = useRef(null);
  const pendingYouTubeRef = useRef(null);
  const preparedRef = useRef(null);
  const startYouTubeRef = useRef(null);
  const prepareYouTubeRef = useRef(null);
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
        height: '1',
        width: '1',
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
            // A play requested before the player finished loading was
            // queued — start it now that the player is ready.
            if (pendingYouTubeRef.current) {
              const queued = pendingYouTubeRef.current;
              pendingYouTubeRef.current = null;
              if (queued.mode === 'prepare') {
                prepareYouTubeRef.current?.(queued.id, queued.startSec, queued.token);
              } else {
                startYouTubeRef.current?.(queued.id, queued.startSec, queued.token);
              }
            }
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
      if (ytRetryRef.current) clearInterval(ytRetryRef.current);
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


  const preloadSong = useCallback((videoId, startTime = 0) => {
    if (!player || !isReady || !videoId) return;

    // Only re-cue if the video or its start position changed.
    if (preloadedVideoIdRef.current === videoId &&
        preloadedStartRef.current === startTime) return;

    try {
      // Use cueVideoById to buffer the video without playing
      player.cueVideoById({
        videoId,
        startSeconds: startTime
      });
      preloadedVideoIdRef.current = videoId;
      preloadedStartRef.current = startTime;
    } catch (error) {
      console.warn('Failed to preload video:', error);
    }
  }, [player, isReady]);

  // --- YouTube playback reliability ----------------------------------------
  // playVideo() is a silent no-op while the player is still buffering,
  // which used to leave the mini player stuck on "play" (the user had to
  // tap again). The retry loop keeps the play intent alive until the
  // player actually reports PLAYING; it stops on pause, stop, song end,
  // or when a newer play supersedes this one (token check).
  const stopYtRetry = useCallback(() => {
    if (ytRetryRef.current) {
      clearInterval(ytRetryRef.current);
      ytRetryRef.current = null;
    }
  }, []);

  const startYtRetry = useCallback((token) => {
    stopYtRetry();
    let attempts = 0;
    ytRetryRef.current = setInterval(() => {
      if (token !== playTokenRef.current) {
        stopYtRetry();
        return;
      }
      // Give up after ~10s so a dead/errored video doesn't loop forever.
      if (++attempts > 40) {
        stopYtRetry();
        return;
      }
      let state = -1;
      try { state = player.getPlayerState(); } catch { /* ignore */ }
      if (state === 1 /* YT.PlayerState.PLAYING */) {
        stopYtRetry();
        return;
      }
      try { player.playVideo(); } catch { /* ignore */ }
    }, 250);
  }, [player, stopYtRetry]);

  // Start (or queue) playback of a YouTube video at startSec.
  const startYouTube = useCallback((id, startSec, token = playTokenRef.current) => {
    if (token !== playTokenRef.current) return;
    modeRef.current = 'yt';
    setIsOffline(false);
    audioRef.current?.pause();
    preparedRef.current = null;

    if (!player || !isReady) {
      // Player still loading — queue the start so it fires once it's ready.
      pendingYouTubeRef.current = { id, startSec, token };
      return;
    }

    stopYtRetry();
    player.setVolume(100);

    // If this exact video is already buffered (preloaded during the
    // announcement), starting is instant. Otherwise loadVideoById loads the
    // video AND queues playback, so the song starts as soon as the buffer
    // at startSec is ready — no fixed-timeout gamble (too early = scratch,
    // too late = delay).
    const sameCue = preloadedVideoIdRef.current === id &&
                    preloadedStartRef.current === startSec;
    if (sameCue) {
      try { player.playVideo(); } catch { /* ignore */ }
    } else {
      try {
        player.loadVideoById({ videoId: id, startSeconds: startSec });
      } catch {
        try { player.cueVideoById({ videoId: id, startSeconds: startSec }); } catch { /* ignore */ }
      }
    }

    startYtRetry(token);
  }, [player, isReady, stopYtRetry, startYtRetry]);

  // Keep the latest startYouTube reachable from the player's onReady
  // handler (which captures the first render's scope).
  useEffect(() => {
    startYouTubeRef.current = startYouTube;
  });

  // --- Muted pre-roll -------------------------------------------------------
  // iOS Safari blocks unmuted autoplay outside a user gesture. The walk-up
  // announcement runs between the tap and the song, so a plain playVideo()
  // after it can be silently refused — the "had to press play manually"
  // bug. Muted playback is always allowed, so prepareYouTube() starts the
  // video muted (buffering + playing silently) right inside the tap, and
  // commitYouTube() seeks to the exact start second and unmutes when the
  // announcement finishes. No gesture needed for unmute.
  const prepareYouTube = useCallback((id, startSec, token = ++playTokenRef.current) => {
    modeRef.current = 'yt';
    setIsOffline(false);
    audioRef.current?.pause();
    preparedRef.current = { id, startSec, token };

    if (!player || !isReady) {
      // Player still loading — do the muted pre-roll once it's ready.
      pendingYouTubeRef.current = { id, startSec, token, mode: 'prepare' };
      return;
    }

    stopYtRetry();
    try {
      player.mute();
      player.setVolume(100);
      player.loadVideoById({ videoId: id, startSeconds: startSec });
      player.playVideo();
    } catch { /* fall through — commitYouTube will do a full start */ }
  }, [player, isReady, stopYtRetry]);

  const commitYouTube = useCallback((startSec, duration) => {
    const p = preparedRef.current;
    preparedRef.current = null;
    if (!p) return; // nothing was prepared (Apple path)
    if (p.token !== playTokenRef.current) return; // superseded by a newer play

    if (!player || !isReady) {
      // Player never became ready — queue a full start for when it does.
      pendingYouTubeRef.current = { id: p.id, startSec, token: p.token, mode: 'commit' };
      return;
    }

    playbackEndTimeRef.current = (startSec || 0) + (duration || 30);
    try {
      // The muted pre-roll has advanced past startSec — seek back to the
      // exact start second, unmute, and make sure it's playing.
      player.seekTo(startSec || 0, true);
      player.unMute();
      player.playVideo();
    } catch { /* fall through */ }
    startYtRetry(p.token);
  }, [player, isReady, startYtRetry]);

  // Keep the latest prepareYouTube reachable from onReady too.
  useEffect(() => {
    prepareYouTubeRef.current = prepareYouTube;
  });

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
          stopYtRetry();
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
  }, [isPlaying, player, fadeOut, stopYtRetry]);

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

    // Legacy path: play through the (hidden) YouTube player. The start is
    // delegated to the shared startYouTube helper, which handles buffering,
    // retries, and queueing while the player is still loading.
    const startYouTube = (id, startSec) => {
      startYouTubeRef.current(id, startSec, token);
    };

    // Audio-element path: plays either a saved blob (`saved` true) or a
    // streamed Apple preview URL (`saved` false). Trimmed saved clips play
    // from 0:00; legacy full-preview blobs start at the window's startTime.
    const startAudio = (url, saved, startAt = startTime) => {
      if (token !== playTokenRef.current) return;
      modeRef.current = 'audio';
      setIsOffline(!!saved);
      preparedRef.current = null;
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
  }, [player, fadeIn]);

  const pauseSong = useCallback(() => {
    stopYtRetry();
    pendingYouTubeRef.current = null;
    preparedRef.current = null;
    fadeOut(() => {
      if (modeRef.current === 'audio') {
        audioRef.current?.pause();
      } else {
        player?.pauseVideo();
      }
    });
  }, [player, fadeOut, stopYtRetry]);

  const resumeSong = useCallback(() => {
    if (modeRef.current === 'audio') {
      const playPromise = audioRef.current?.play();
      if (playPromise && playPromise.catch) playPromise.catch(() => {});
      fadeIn();
    } else {
      try { player?.unMute(); } catch { /* ignore */ }
      player?.playVideo();
      fadeIn();
    }
  }, [player, fadeIn]);

  const stopSong = useCallback(() => {
    stopYtRetry();
    pendingYouTubeRef.current = null;
    preparedRef.current = null;
    fadeOut(() => {
      if (modeRef.current === 'audio') {
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
      } else {
        player?.stopVideo();
      }
      playbackEndTimeRef.current = null;
      onSongEndRef.current = null;
    });
  }, [player, fadeOut, stopYtRetry]);

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
    prepareYouTube,
    commitYouTube,
    pauseSong,
    resumeSong,
    stopSong,
    setVolume
  };
};
