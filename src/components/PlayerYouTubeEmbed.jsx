import { useEffect, useRef, useState } from 'react';
import { loadYouTubeAPI } from '../utils/youtube';
import './PlayerYouTubeEmbed.css';

export default function PlayerYouTubeEmbed({
  player,
  isActive,
  onReady,
  onEnded
}) {
  const playerRef = useRef(null);
  const containerRef = useRef(null);
  const [ytPlayer, setYtPlayer] = useState(null);

  useEffect(() => {
    console.log('PlayerYouTubeEmbed mounting for:', player.name, player.id);

    if (!player.songVideoId) {
      console.log('No songVideoId for:', player.name);
      return;
    }

    // Add a delay based on player ID to stagger initialization
    // This prevents all players from trying to initialize at once
    const initDelay = Math.abs(player.id % 12) * 300; // 0-3.6 seconds stagger

    console.log('Loading YouTube API for:', player.name, 'with delay:', initDelay);

    const timeoutId = setTimeout(() => {
      loadYouTubeAPI().then((YT) => {
        console.log('Creating YouTube player for:', player.name, `youtube-player-${player.id}`);
        const newPlayer = new YT.Player(`youtube-player-${player.id}`, {
        height: '200',
        width: '100%',
        videoId: player.songVideoId,
        playerVars: {
          controls: 1,
          modestbranding: 1,
          playsinline: 1,
          start: player.startTime || 0
        },
        events: {
          onReady: (event) => {
            console.log('YouTube player ready for:', player.name, player.id);
            playerRef.current = event.target;
            setYtPlayer(event.target);
            if (onReady) {
              console.log('Calling onReady callback for:', player.name);
              onReady(player.id, event.target);
            }
          },
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.ENDED && onEnded) {
              onEnded(player.id);
            }
          }
        }
      });
      }).catch(error => {
        console.error('Failed to create player for:', player.name, error);
      });
    }, initDelay);

    return () => {
      clearTimeout(timeoutId);
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy();
      }
    };
  }, [player.id, player.songVideoId]);

  // Monitor playback and stop at duration
  useEffect(() => {
    if (!ytPlayer || !isActive) return;

    const endTime = (player.startTime || 0) + (player.duration || 30);
    const interval = setInterval(() => {
      const currentTime = ytPlayer.getCurrentTime?.();
      if (currentTime && currentTime >= endTime) {
        ytPlayer.pauseVideo();
        if (onEnded) onEnded(player.id);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [ytPlayer, isActive, player.startTime, player.duration, player.id, onEnded]);

  return (
    <div
      ref={containerRef}
      id={`youtube-player-${player.id}`}
      className="youtube-embed-container"
    />
  );
}
