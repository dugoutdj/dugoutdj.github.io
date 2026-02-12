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
    if (!player.songVideoId) return;

    loadYouTubeAPI().then((YT) => {
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
            playerRef.current = event.target;
            setYtPlayer(event.target);
            if (onReady) onReady(player.id, event.target);
          },
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.ENDED && onEnded) {
              onEnded(player.id);
            }
          }
        }
      });
    });

    return () => {
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
