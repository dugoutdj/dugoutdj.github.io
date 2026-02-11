import { useState, useEffect, useRef, useCallback } from 'react';
import { loadYouTubeAPI } from '../utils/youtube';

export const useYouTubePlayer = () => {
  const [player, setPlayer] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef(null);
  const intervalRef = useRef(null);
  const fadeIntervalRef = useRef(null);
  const playbackEndTimeRef = useRef(null);
  const onSongEndRef = useRef(null);
  const preloadedVideoIdRef = useRef(null);
  const playRetryIntervalRef = useRef(null);

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
              setIsLoading(false);
            } else if (event.data === YT.PlayerState.PAUSED ||
                       event.data === YT.PlayerState.ENDED) {
              setIsPlaying(false);
            } else if (event.data === YT.PlayerState.BUFFERING) {
              setIsLoading(true);
            }
          }
        }
      });
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
      if (playRetryIntervalRef.current) clearInterval(playRetryIntervalRef.current);
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

  const preloadSong = useCallback((videoId, startTime = 0, callback) => {
    if (!player || !isReady || !videoId) {
      if (callback) callback(false);
      return;
    }

    // Only preload if it's a different video than what's already preloaded
    if (preloadedVideoIdRef.current === videoId) {
      if (callback) callback(true);
      return;
    }

    try {
      // Use cueVideoById to buffer the video without playing
      player.cueVideoById({
        videoId,
        startSeconds: startTime
      });
      preloadedVideoIdRef.current = videoId;

      // Wait a bit for the video to load, then check if it's ready
      setTimeout(() => {
        try {
          const state = player.getPlayerState ? player.getPlayerState() : -1;
          // State 5 = video cued (ready), state -1 = unstarted but loaded
          const success = state === 5 || state === -1 || state === 2;
          if (callback) callback(success);
        } catch (e) {
          if (callback) callback(false);
        }
      }, 2000); // Give 2 seconds for buffering
    } catch (error) {
      console.warn('Failed to preload video:', error);
      if (callback) callback(false);
    }
  }, [player, isReady]);

  const playSong = useCallback((videoId, startTime = 0, duration = 30, onEnd) => {
    if (!player || !isReady) {
      console.warn('Player not ready yet');
      return;
    }

    // Clear any previous retry interval
    if (playRetryIntervalRef.current) {
      clearInterval(playRetryIntervalRef.current);
      playRetryIntervalRef.current = null;
    }

    onSongEndRef.current = onEnd;
    playbackEndTimeRef.current = startTime + duration;

    // Set loading state
    setIsLoading(true);

    // Set volume to full immediately
    player.setVolume(100);

    try {
      // Check if this video is already preloaded/cued
      const isPreloaded = preloadedVideoIdRef.current === videoId;

      if (isPreloaded) {
        // Video is already buffered, just seek and play
        console.log('Using preloaded video');
        player.seekTo(startTime, true);
        player.playVideo();
        // Clear the preloaded reference
        preloadedVideoIdRef.current = null;
      } else {
        // Video not preloaded, load it fresh
        console.log('Loading video fresh');
        preloadedVideoIdRef.current = null;
        player.loadVideoById({
          videoId,
          startSeconds: startTime
        });
      }

      // Keep trying to play until it works or timeout (15 seconds for slow connections)
      let attempts = 0;
      const maxAttempts = 30; // 30 attempts * 500ms = 15 seconds

      playRetryIntervalRef.current = setInterval(() => {
        attempts++;

        if (!player || !player.getPlayerState) {
          if (attempts >= maxAttempts) {
            clearInterval(playRetryIntervalRef.current);
            playRetryIntervalRef.current = null;
            setIsLoading(false);
            console.error('Player not available after timeout');
          }
          return;
        }

        const state = player.getPlayerState();
        // States: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued

        if (state === 1) {
          // Playing! Success
          clearInterval(playRetryIntervalRef.current);
          playRetryIntervalRef.current = null;
          setIsLoading(false);
        } else if (state === 3) {
          // Buffering - keep waiting
          console.log('Video buffering...');
        } else if (state === 5 || state === 2 || state === -1) {
          // Video is cued/paused/unstarted - try to play
          try {
            player.playVideo();
          } catch (e) {
            console.warn('Play attempt failed:', e);
          }
        }

        // Timeout after max attempts
        if (attempts >= maxAttempts) {
          clearInterval(playRetryIntervalRef.current);
          playRetryIntervalRef.current = null;
          setIsLoading(false);
          console.error('Failed to start playback after 15 seconds');
        }
      }, 500);
    } catch (error) {
      console.error('Failed to load video:', error);
      setIsLoading(false);
    }
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
    isLoading,
    currentTime,
    playSong,
    preloadSong,
    pauseSong,
    resumeSong,
    stopSong,
    setVolume
  };
};
