import { useState, useEffect, useRef, useCallback } from 'react';
import { loadYouTubeAPI } from '../utils/youtube';

export const useYouTubePlayer = () => {
  const [player, setPlayer] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef(null);
  const intervalRef = useRef(null);
  const fadeIntervalRef = useRef(null);
  const playbackEndTimeRef = useRef(null);
  const onSongEndRef = useRef(null);
  const preloadedVideoIdRef = useRef(null);

  useEffect(() => {
    loadYouTubeAPI().then((YT) => {
      const newPlayer = new YT.Player('youtube-player', {
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
    };
  }, []);

  // Monitor playback time
  useEffect(() => {
    if (isPlaying && player) {
      intervalRef.current = setInterval(() => {
        const time = player.getCurrentTime();
        setCurrentTime(time);

        // Check if we've reached the end time
        if (playbackEndTimeRef.current && time >= playbackEndTimeRef.current) {
          fadeOut(() => {
            player.pauseVideo();
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
  }, [isPlaying, player]);

  const fadeIn = useCallback((callback) => {
    if (!player) return;

    let volume = 0;
    player.setVolume(volume);

    if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);

    fadeIntervalRef.current = setInterval(() => {
      volume += 5;
      if (volume >= 100) {
        volume = 100;
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
        if (callback) callback();
      }
      player.setVolume(volume);
    }, 50);
  }, [player]);

  const fadeOut = useCallback((callback) => {
    if (!player) return;

    let volume = player.getVolume();

    if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);

    fadeIntervalRef.current = setInterval(() => {
      volume -= 5;
      if (volume <= 0) {
        volume = 0;
        player.setVolume(volume);
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
        if (callback) callback();
      } else {
        player.setVolume(volume);
      }
    }, 50);
  }, [player]);

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

  const playSong = useCallback((videoId, startTime = 0, duration = 30, onEnd) => {
    if (!player || !isReady) return;

    onSongEndRef.current = onEnd;
    playbackEndTimeRef.current = startTime + duration;

    // Clear any preloaded video first
    preloadedVideoIdRef.current = null;

    // Set volume to full immediately
    player.setVolume(100);

    // Use cueVideoById (loads but doesn't auto-play) instead of loadVideoById
    // This gives us full control over when playback starts
    player.cueVideoById({
      videoId,
      startSeconds: startTime
    });

    // Explicitly play after video is cued - works like mini player
    setTimeout(() => {
      if (player && player.playVideo) {
        player.playVideo();
      }
    }, 200);
  }, [player, isReady]);

  const pauseSong = useCallback(() => {
    if (!player) return;
    fadeOut(() => {
      player.pauseVideo();
    });
  }, [player, fadeOut]);

  const resumeSong = useCallback(() => {
    if (!player) return;
    player.playVideo();
    fadeIn();
  }, [player, fadeIn]);

  const stopSong = useCallback(() => {
    if (!player) return;
    fadeOut(() => {
      player.stopVideo();
      playbackEndTimeRef.current = null;
      onSongEndRef.current = null;
    });
  }, [player, fadeOut]);

  const setVolume = useCallback((volume) => {
    if (!player) return;
    player.setVolume(Math.max(0, Math.min(100, volume)));
  }, [player]);

  return {
    isReady,
    isPlaying,
    currentTime,
    playSong,
    preloadSong,
    pauseSong,
    resumeSong,
    stopSong,
    setVolume
  };
};
