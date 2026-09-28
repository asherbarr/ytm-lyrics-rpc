const UI_ZOOM_FACTOR = 0.75;

const webview = document.getElementById("ytm");
const lyricsPaneEl = document.getElementById("lyrics-pane");
const titleEl = document.getElementById("lyrics-title");
const artistEl = document.getElementById("lyrics-artist");
const linesEl = document.getElementById("lyrics-lines");

window.api.setZoomFactor(UI_ZOOM_FACTOR);

document.getElementById("btn-minimize").addEventListener("click", () => window.api.minimizeWindow());
document.getElementById("btn-maximize").addEventListener("click", () => window.api.toggleMaximizeWindow());
document.getElementById("btn-close").addEventListener("click", () => window.api.closeWindow());

// Electron's default UA includes "YouTubeMusic/1.0.0 ... Electron/x.y.z", which flags
// this as an embedded webview to YouTube and makes it serve a degraded UI missing the
// player-bar icon assets. A plain desktop Chrome UA avoids that.
webview.setAttribute(
  "useragent",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
);
webview.src = "https://music.youtube.com";

// Hide YTM's own Lyrics/Comments/Related tabs in the queue panel — we show synced
// lyrics in our own sidebar instead, and Up Next is the only tab worth keeping.
// Also hide the whole Up Next side panel by default, with a small toggle button to
// slide it open/closed — the video area smoothly reclaims/cedes the space since it's
// just YTM's own flex layout responding to the panel's width.
const HIDE_TABS_CSS = `
#tabsContent tp-yt-paper-tab.tab-header:not(:first-of-type) {
  display: none !important;
}

#side-panel {
  transition: width 0.25s ease, opacity 0.2s ease, margin 0.25s ease;
}

html.ytmd-queue-hidden #side-panel {
  width: 0 !important;
  min-width: 0 !important;
  margin: 0 !important;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

#ytmd-queue-toggle {
  position: fixed;
  top: 88px;
  right: 12px;
  z-index: 9999;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

#ytmd-queue-toggle:hover {
  background: rgba(255, 255, 255, 0.28);
}
`;

// Runs in the guest page's real main world (default for executeJavaScript) so it can
// reach playerApi directly and add real DOM elements/listeners to YTM's own page.
const SETUP_QUEUE_TOGGLE_AND_WHEEL_VOLUME_SCRIPT = `
(function() {
  document.documentElement.classList.add("ytmd-queue-hidden");

  // No stable class/href to target "Explore" alone (it shares a class with every guide
  // entry, and the sidebar is rendered twice — mini + full), so match by label text.
  document.querySelectorAll("ytmusic-guide-entry-renderer").forEach(entry => {
    if (entry.textContent.trim() === "Explore") entry.style.display = "none";
  });

  if (!document.getElementById("ytmd-queue-toggle")) {
    const btn = document.createElement("button");
    btn.id = "ytmd-queue-toggle";
    btn.type = "button";
    btn.textContent = "\\u2039";
    btn.title = "Show queue";
    btn.addEventListener("click", () => {
      const hidden = document.documentElement.classList.toggle("ytmd-queue-hidden");
      btn.textContent = hidden ? "\\u2039" : "\\u203A";
      btn.title = hidden ? "Show queue" : "Hide queue";
    });
    document.body.appendChild(btn);
  }

  const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const videoArea = document.querySelector("#player");
  if (playerBar && playerBar.playerApi && videoArea && !videoArea.dataset.ytmdWheelBound) {
    videoArea.dataset.ytmdWheelBound = "1";
    videoArea.addEventListener(
      "wheel",
      event => {
        event.preventDefault();
        const api = playerBar.playerApi;
        const next = Math.max(0, Math.min(100, api.getVolume() + (event.deltaY < 0 ? 2 : -2)));
        api.setVolume(next);
        if (next > 0 && api.isMuted && api.isMuted() && api.unMute) api.unMute();
      },
      { passive: false }
    );
  }
})();
`;

let currentTrackKey = null;
let lyricsLines = []; // [{ time: seconds, text: string }]
let activeLineIndex = -1;

// `playerApi`/`currentItem` are JS properties YTM's own framework attaches to the
// player-bar element (not DOM attributes), so they're invisible to an isolated-world
// preload script. executeJavaScript runs in the guest page's real main world, where
// those properties are visible.
const EXTRACT_STATE_SCRIPT = `
(function() {
  function pickLargestThumbnail(thumbnails) {
    if (!Array.isArray(thumbnails) || !thumbnails.length) return null;
    return thumbnails.reduce((best, t) => (t.width * t.height > best.width * best.height ? t : best), thumbnails[0]).url;
  }
  function extractAlbum(currentItem) {
    const runs = currentItem && currentItem.longBylineText && currentItem.longBylineText.runs;
    if (!Array.isArray(runs)) return null;
    for (const run of runs) {
      const pageType = run.navigationEndpoint && run.navigationEndpoint.browseEndpoint &&
        run.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs &&
        run.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig &&
        run.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType;
      if (pageType === "MUSIC_PAGE_TYPE_ALBUM") return run.text;
    }
    return null;
  }

  const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const video = document.querySelector("video");
  if (!playerBar || !playerBar.playerApi || !video) return null;

  const playerResponse = playerBar.playerApi.getPlayerResponse();
  const videoDetails = playerResponse && playerResponse.videoDetails;
  if (!videoDetails || !videoDetails.title) return null;

  const currentItem = playerBar.currentItem;
  const title = currentItem && currentItem.title && currentItem.title.runs && currentItem.title.runs.length
    ? currentItem.title.runs.map(r => r.text).join("")
    : videoDetails.title;
  const thumbnails = (currentItem && currentItem.thumbnail && currentItem.thumbnail.thumbnails) ||
    (videoDetails.thumbnail && videoDetails.thumbnail.thumbnails);

  return {
    title,
    artist: videoDetails.author || null,
    album: extractAlbum(currentItem),
    thumbnail: pickLargestThumbnail(thumbnails),
    duration: Number.isFinite(video.duration) ? video.duration : (Number(videoDetails.lengthSeconds) || null),
    currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
    isPaused: video.paused
  };
})();
`;

function parseLrc(lrc) {
  const lines = [];
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]([^\n\r]*)/g;
  let match;
  while ((match = regex.exec(lrc)) !== null) {
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const millis = match[3] ? parseInt(match[3].padEnd(3, "0"), 10) : 0;
    const time = minutes * 60 + seconds + millis / 1000;
    const text = match[4].trim();
    if (text) lines.push({ time, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

function renderLyricsShell() {
  linesEl.innerHTML = "";
  lyricsLines.forEach(line => {
    const li = document.createElement("li");
    li.textContent = line.text;
    linesEl.appendChild(li);
  });
  activeLineIndex = -1;
}

function updateActiveLine(currentTime) {
  if (!lyricsLines.length) return;

  let newIndex = -1;
  for (let i = 0; i < lyricsLines.length; i++) {
    if (lyricsLines[i].time <= currentTime) newIndex = i;
    else break;
  }
  if (newIndex === activeLineIndex) return;

  const prevEl = linesEl.querySelector(".active");
  if (prevEl) prevEl.classList.remove("active");

  activeLineIndex = newIndex;
  if (activeLineIndex >= 0) {
    const el = linesEl.children[activeLineIndex];
    if (el) {
      el.classList.add("active");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}

async function maybeLoadLyrics(state) {
  const key = `${state.title}::${state.artist}::${state.album}`;
  if (key === currentTrackKey) return;
  currentTrackKey = key;

  lyricsLines = [];
  renderLyricsShell();
  lyricsPaneEl.classList.remove("visible"); // Hidden while loading; slides in only once lyrics are ready.

  const result = await window.api.fetchLyrics({
    track: state.title,
    artist: state.artist,
    album: state.album,
    duration: state.duration
  });

  if (currentTrackKey !== key) return; // Track changed again while the request was in flight.

  if (result && result.syncedLyrics) {
    lyricsLines = parseLrc(result.syncedLyrics);
    renderLyricsShell();
    lyricsPaneEl.classList.toggle("visible", lyricsLines.length > 0);
  }
}

let lastSignature = null;

async function pollPlayerState() {
  let state;
  try {
    state = await webview.executeJavaScript(EXTRACT_STATE_SCRIPT);
  } catch (err) {
    return; // Guest page not ready yet (e.g. still navigating).
  }
  if (!state) {
    currentTrackKey = null;
    lyricsPaneEl.classList.remove("visible");
    return;
  }

  const signature = `${state.title}|${state.artist}|${state.album}|${state.isPaused}|${Math.floor(state.currentTime)}`;
  if (signature === lastSignature) return;
  lastSignature = signature;

  titleEl.textContent = state.title;
  artistEl.textContent = state.album ? `${state.artist || "Unknown artist"} • ${state.album}` : state.artist || "Unknown artist";

  window.api.sendPlayerState(state);
  maybeLoadLyrics(state);
  updateActiveLine(state.currentTime);
}

webview.addEventListener("dom-ready", () => {
  webview.setZoomFactor(UI_ZOOM_FACTOR);
  webview.insertCSS(HIDE_TABS_CSS);
  webview.executeJavaScript(SETUP_QUEUE_TOGGLE_AND_WHEEL_VOLUME_SCRIPT);
  setInterval(pollPlayerState, 500);
});
