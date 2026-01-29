# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dugout DJ is a mobile-first web application for managing and playing walk-up songs for baseball players using YouTube videos. The app allows teams to create player rosters with custom songs, manage batting orders, and play song clips with automatic fade in/out and progression through the lineup.

## Development Commands

```bash
# Start development server (runs on http://localhost:5173)
npm run dev

# Build for production (outputs to dist/)
npm run build

# Preview production build locally
npm run preview

# Run ESLint
npm run lint
```

## Architecture

### State Management
The app uses React hooks for state management with two primary custom hooks:
- **`useLocalStorage`** (src/hooks/useLocalStorage.js): Manages all team and player data, automatically persisting to browser localStorage
- **`useYouTubePlayer`** (src/hooks/useYouTubePlayer.js): Manages YouTube IFrame Player API, handles playback, volume fading, and timing

### Data Structure
Data is stored in localStorage with the following structure:
```javascript
{
  teams: [
    {
      id: timestamp,
      name: string,
      players: [
        {
          id: timestamp,
          name: string,
          number: string,
          songUrl: string,
          songVideoId: string,
          songTitle: string,
          songThumbnail: string,
          startTime: number, // seconds
          duration: number,  // seconds
          order: number
        }
      ]
    }
  ],
  currentTeamId: number
}
```

### Component Architecture
- **App.jsx**: Main container that orchestrates state and coordinates between hooks and UI components
- **TeamSelector**: Sidebar for managing and switching between teams
- **PlayerList**: Displays roster with drag-and-drop reordering
- **PlayerForm**: Form for adding/editing players with YouTube song configuration
- **PlaybackControls**: Main playback interface with play/pause/next/previous/replay controls
- **YouTubePlayer**: Hidden YouTube IFrame player container (height/width: 0)
- **ShareDialog**: Export/import team data as JSON files or clipboard text

### YouTube Integration
The app uses the YouTube IFrame Player API (loaded dynamically):
- Player is initialized as a hidden element (0x0 dimensions, audio only)
- Video playback is controlled programmatically with custom start times and durations
- Volume fade in/out effects are implemented using 50ms intervals (5% volume increments)
- Playback monitoring checks current time every 100ms to stop at the configured end time
- **Note**: Preloading functionality is currently disabled (see App.jsx lines 35-57) due to playback interference issues

### Utilities
- **src/utils/storage.js**: localStorage save/load, data export/import via JSON files
- **src/utils/youtube.js**: Extract video IDs from various YouTube URL formats, fetch video metadata via oEmbed API (no API key required), time formatting/parsing

## Technical Constraints

- YouTube IFrame Player API must be loaded before player initialization
- All YouTube videos require internet connection to play
- localStorage is the sole data persistence mechanism (no backend)
- Mobile-first design optimized for touch interactions and Bluetooth speakers
- No YouTube Data API key included by default (search falls back to opening YouTube in new tab)

## Known Issues

- Preloading next video is currently disabled to prevent interference with current playback
- ESLint warning about unused `hasPlayedOnce` variable in App.jsx (remnant from disabled preloading code)
