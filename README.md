# YouTube Music (lyrics + Discord RPC)

A from-scratch Electron desktop app that wraps music.youtube.com in a native window and adds:

- **Synced lyrics** — fetched from [LRCLIB](https://lrclib.net) (free, no API key) and highlighted line-by-line as the song plays.
- **Discord Rich Presence** — shows the track thumbnail, a live progress timeline, song title, artist, and album (when available).
- **Runs in the background** — closing the window hides it to the system tray instead of quitting, so lyrics tracking and Discord RPC keep working. Use the tray icon's "Quit" to fully exit.
- Registered in the Linux application grid as **"YouTube Music"**, with the official YTM icon.

## One-time setup: Discord Client ID

Discord Rich Presence requires a Discord application Client ID. This app currently reuses the community ytmdesktop project's client ID (`1143202598460076053`) by default, so RPC works out of the box. To use your own instead:

1. Go to https://discord.com/developers/applications and click **New Application**.
2. Copy its **Client ID** from the General Information page.
3. Open `~/.config/YouTube Music/config.json` and set `"discordClientId"` to your ID.
4. Quit the app fully (tray → Quit) and restart.

Optional cosmetic step: under **Rich Presence > Art Assets** in the Discord Developer Portal, upload two images keyed `play` and `pause` to get a small play/pause badge on the presence. Without them, Discord just omits the small icon.

## Signing in to Google

Click **Sign in** inside YouTube Music as usual; the session is stored in the app's data folder, so you stay signed in across restarts.

Google blocks sign-in from embedded browsers that identify as Electron, so `src/main/google-auth.js`:

- replaces the global user agent with a plain Chrome one that matches the bundled Chromium version (no `Electron/` or app-name tokens), keeping it consistent with the browser's own client hints;
- sends a Firefox user agent (and drops `sec-ch-ua*` headers) only on requests to `accounts.google.com`;
- keeps `accounts.google.com` pop-ups inside the player and opens every other new-window link in your default browser.

## Development

```bash
npm install
npm start
```

## How it works

- `src/renderer/renderer.js` polls the embedded YouTube Music page via `webview.executeJavaScript()`, reading `playerApi.getPlayerResponse().videoDetails` and `currentItem` off the player-bar element (the same object the page's own UI reads from) for title/artist/album/thumbnail/duration. This runs in the guest page's real main world — a preload-based approach can't see these because they're JS properties the page's own framework attaches to the DOM node, invisible across the isolated-world boundary.
- It renders the synced-lyrics panel and forwards playback state to the main process.
- `src/main/discord-rpc.js` pushes the state to Discord via `@xhayper/discord-rpc`. Note: that library's `largeImageKey` (not `largeImageUrl`) is what actually sets the image — `largeImageUrl` is only the click-through link.
- `src/main/lyrics.js` looks up synced lyrics on LRCLIB by track/artist/album/duration.
