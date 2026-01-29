# Dugout DJ

A mobile-first web application for managing and playing walk-up songs for baseball players. Play music clips from YouTube as each player prepares to bat!

## Features

- **Team Management**: Create and manage multiple teams with different rosters
- **Player Roster**: Add players with names, jersey numbers, and individual walk-up songs
- **Song Configuration**:
  - Link YouTube videos for each player's song
  - Set custom start time and duration for each song
  - Search YouTube directly within the app
- **Playback Controls**:
  - Play songs in batting order
  - Manual controls (play, pause, stop, skip, replay)
  - Automatic progression through the lineup
  - Volume fade in/out for smooth transitions
- **Batting Order**: Drag-and-drop or use up/down buttons to reorder players
- **Share & Backup**:
  - Export your team data as a JSON file
  - Share via clipboard to text/email
  - Import data from another device
- **Mobile Optimized**: Responsive design optimized for mobile devices
- **Bluetooth Speaker Support**: Works seamlessly with Bluetooth speakers

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone or download this repository
2. Navigate to the project directory:
   ```bash
   cd walkup-songs
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open your browser to [http://localhost:5173](http://localhost:5173)

### Building for Production

To build the app for production:

```bash
npm run build
```

The built files will be in the `dist` directory, which you can deploy to any static hosting service.

To preview the production build locally:

```bash
npm run preview
```

## How to Use

### Setting Up a Team

1. When you first open the app, a default team "My Team" will be created
2. Click "Add Team" to create additional teams
3. Click on a team name to switch between teams
4. Use the edit (✏️) or delete (🗑️) buttons to manage teams

### Adding Players

1. Select a team from the sidebar
2. Click "Add Player"
3. Fill in the player information:
   - **Player Name**: Required
   - **Jersey Number**: Optional
   - **Song**: Paste a YouTube URL or use the search feature
   - **Start Time**: When the song should begin (format: mm:ss)
   - **Duration**: How long the song should play (in seconds)
4. Click "Add Player" to save

### Finding Songs

You have two options for finding songs:

1. **Direct URL**: Copy a YouTube URL and paste it directly in the song field
2. **Search**: Click the "🔍 Search" button to search YouTube
   - Note: Without a YouTube API key, clicking search will open YouTube in a new tab
   - Copy the video URL from YouTube and paste it back in the app

### Managing Batting Order

- **Drag and Drop**: Click and drag players to reorder them
- **Up/Down Buttons**: Use the ▲ and ▼ buttons next to each player
- The order number shows the current batting position

### Playing Songs

1. **Auto-play Mode**: Click the main ▶ button to start playing through the lineup in order
2. **Manual Play**: Click the ▶ button next to any player to play their song
3. **Playback Controls**:
   - ⏮ Previous player
   - 🔄 Replay current song
   - ▶/⏸ Play/Pause
   - ⏹ Stop
   - ⏭ Next player

The app will automatically:
- Fade in the volume at the start
- Play for the configured duration
- Fade out the volume at the end
- Move to the next player

### Sharing with Other Parents

1. Click the "📤 Share" button in the header
2. Choose an option:
   - **Download Backup File**: Downloads a JSON file
   - **Copy to Clipboard**: Copy data to share via text/email
3. Send the file or data to another parent
4. They can click "Import" and load your team configuration

### Connecting to a Bluetooth Speaker

1. Pair your device with your Bluetooth speaker (use your device's Bluetooth settings)
2. Ensure audio is routed to the speaker
3. Open the app and start playing songs
4. The audio will automatically play through the connected speaker

## Data Storage

All team and player data is stored locally in your browser's Local Storage. This means:
- ✅ Your data persists between sessions
- ✅ No internet connection required (except for playing YouTube videos)
- ⚠️ Data is specific to your browser and device
- ⚠️ Clearing browser data will erase your teams

**Always keep backups** by using the Export feature!

## Technology Stack

- **React**: UI framework
- **Vite**: Build tool and dev server
- **YouTube IFrame Player API**: Video playback
- **Local Storage**: Data persistence
- **CSS3**: Styling with CSS custom properties

## Browser Support

The app works best on modern browsers:
- Chrome/Edge (recommended for mobile)
- Safari (iOS)
- Firefox
- Any modern mobile browser

## Tips & Best Practices

1. **Test Songs Before the Game**: Make sure all YouTube links work and start times are correct
2. **Keep Durations Short**: 15-30 seconds is usually sufficient for walk-up songs
3. **Backup Regularly**: Export your team data after making changes
4. **Mobile Device**: Use a tablet or phone at the field for easy portability
5. **Bluetooth Speaker**: A portable speaker provides better sound than phone speakers
6. **Battery**: Keep your device charged or bring a portable charger
7. **Offline Preparation**: Load the app and test it before going to the field (you'll still need internet for YouTube playback)

## Troubleshooting

**Songs won't play:**
- Check your internet connection (YouTube requires online access)
- Verify the YouTube URL is correct
- Try playing the video directly on YouTube to ensure it's not region-blocked

**App is slow or laggy:**
- Close other browser tabs
- Clear browser cache
- Try using a different browser

**Data disappeared:**
- Check if you're using the same browser and device
- Import your last backup if available
- Avoid clearing browser data/cookies

**YouTube search doesn't work:**
- The search feature requires a YouTube API key (not included by default)
- Use the fallback: search on YouTube.com and copy the video URL

## License

This project is provided as-is for personal use. Feel free to modify and use it for your team!

## Support

For issues or questions, please check the existing issues or create a new one on GitHub.

---

Made with ⚾ by Dugout DJ
