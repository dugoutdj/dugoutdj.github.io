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
- **Offline Songs**: Save songs to the device (IndexedDB) and play them without internet — powered by Apple's public 30-second preview API, no backend or API key needed

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
   - **Song**: Search Apple Music and tap the exact recording you want
   - **Walk-up window (5–15s)**: Drag the window's edges to pick exactly
     which part of the preview plays as they walk up
4. Click "Add Player" to save

### Finding Songs

1. **Search Apple Music**: Type into the Song field — live results appear
   with cover art, artist, and album. Tap the recording you want; the title
   auto-fills. Songs are played from Apple's official 30-second previews,
   which are also what gets saved for offline use.

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

1. Click the **🔗 Share with Parents** button next to "Add Player"
2. The app creates a link (e.g. `https://dugoutdj.com/team/abc123`) and copies
   it to your clipboard
3. Send that one link to all the parents — each parent opens it, taps their
   player, and updates the song. Changes save instantly to the shared roster;
   you'll see an "Updated ✓" badge appear on players whose songs changed
   (the app checks every 30 seconds), then tap **Apply updates** to pull them
   into your team.

> Requires the Cloudflare Pages backend (see below). Without it, the older
> file-based sharing still works:
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

## Cloudflare Pages Backend (Share with Parents)

The "Share with Parents" feature needs a small serverless backend to store
the shared roster. It uses **Cloudflare Pages Functions** (free tier) with a
**KV namespace** for storage — no database to manage, no API key to share.

### One-time setup

1. **Create a KV namespace** in the Cloudflare dashboard
   (Workers & Pages → KV → Create namespace), name it `TEAMS`.

2. **Create a Cloudflare Pages project** connected to your GitHub repo
   (`dugoutdj/dugoutdj.github.io`):
   - Framework preset: *React*
   - Build command: `cd walkup-songs && npm install && npm run build`
   - Build output directory: `walkup-songs/dist`
   - (If you prefer the repo root as the Pages root, point the functions dir
     at `walkup-songs/functions` via the build output settings.)

3. **Bind the KV namespace**: Pages project → Settings → Functions →
   KV namespace bindings → add binding with variable name `TEAMS` pointing at
   the namespace from step 1.

4. **Deploy**. `functions/` in this repo is picked up automatically as Pages
   Functions — `functions/api/team.js` becomes `POST /api/team`, etc.

5. **Custom domain**: add `dugoutdj.com` as a custom domain on the Pages
   project so the app and the `/api` and `/team/<id>` routes share one origin
   (this also makes `_redirects` route `/team/<id>` to the SPA).

### API endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/team` | POST | Create/update a shared roster → `{ teamId }` |
| `/api/team/:id` | GET | Fetch the roster |
| `/api/team/:id/player/:pid` | PUT | Update one player's song |
| `/api/team/:id` | DELETE | Remove the roster |

Entries expire from KV after 90 days.

### Fallback if not deployed

The app runs fully without the backend — sharing falls back to the
file/clipboard export described above, and the "Share with Parents" button
shows an error until the Functions are deployed.

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
7. **Offline Preparation**: Songs save automatically when picked — download
   them over Wi-Fi ahead of time so they play without internet at the field

## Offline Songs (Save to Device)

Songs are saved to the browser's local storage (IndexedDB) **automatically**
as soon as a player's song is picked — no button to press. The player row
shows a brief spinner while the preview downloads. The footer shows the
library size, and the song plays from the device — even on airplane mode.
Saved songs are per-device/per-browser.

If a save ever fails (e.g., a network hiccup), the player row shows a 📥
button to retry that one song.

### The walk-up window

Apple provides a **30-second preview** of each song (the hook). When you pick
an Apple Music track, the form shows a timeline of those 30 seconds — drag
the two edge handles to choose which window plays as the player walks up
(anywhere from **5 to 15 seconds**, starting anywhere from 0:00 to 0:25), or
click the track to move the window as a whole (the labels below the slider
show the start, length, and end times). The saved copy is trimmed to exactly
that window (decoded and re-encoded as WAV in the browser), so the offline
file is the clip itself — online and offline playback are identical.
Editing a player and moving the window re-trims the saved copy automatically.

### What you should know

- Saves are automatic and fast (a couple of seconds on Wi-Fi) — no server,
  no API key, no YouTube bot detection.
- The audio is Apple's official recording, so it may differ slightly from a
  YouTube version of the same song — but the selected window is exact.
- Saved blobs are keyed per song, so multiple players with the same song save
  it once.
- The footer shows the library size; use **Clear** to remove all saved
  songs.

### How it works under the hood

- `src/utils/previewDownloader.js` searches `itunes.apple.com/search` (both
  the API and the audio CDN allow browser access), streams the ~1 MB preview,
  then trims it to the chosen window with the Web Audio API (decoded and
  re-encoded as a 5–15-second WAV) before storing it in IndexedDB.
- The service worker (`public/sw.js`) caches the app shell, so once a song is
  saved the whole flow works offline.

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
