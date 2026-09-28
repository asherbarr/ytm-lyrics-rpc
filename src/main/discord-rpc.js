const { Client } = require("@xhayper/discord-rpc");

const ACTIVITY_TYPE_LISTENING = 2;
const RECONNECT_DELAY_MS = 5000;
const ACTIVITY_DEBOUNCE_MS = 500;
const PAUSE_CLEAR_DELAY_MS = 20 * 1000;

let clientId = null;
let client = null;
let ready = false;
let reconnectTimer = null;
let debounceTimer = null;
let pauseTimer = null;
let lastState = null;

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
}

function connect() {
  if (!clientId) return;
  if (client) return;

  client = new Client({ clientId });

  client.on("ready", () => {
    ready = true;
    console.log("[discord-rpc] Connected to Discord");
    if (lastState) applyActivity(lastState);
  });

  client.on("disconnected", () => {
    ready = false;
    client = null;
    scheduleReconnect();
  });

  client.login().catch(err => {
    console.warn("[discord-rpc] Login failed, retrying in 5s:", err.message);
    client = null;
    scheduleReconnect();
  });
}

function applyActivity(state) {
  if (!client || !ready) return;

  const { title, artist, album, thumbnail, currentTime, duration, isPaused } = state;
  const now = Date.now();

  const activity = {
    type: ACTIVITY_TYPE_LISTENING,
    details: title.slice(0, 128),
    state: artist ? artist.slice(0, 128) : undefined,
    // Discord's local RPC accepts a raw https:// URL in the same slot as an asset key.
    // (largeImageUrl is a different field — it's the click-through link, not the image.)
    largeImageKey: thumbnail && thumbnail.length <= 256 ? thumbnail : undefined,
    largeImageText: album ? album.slice(0, 128) : undefined,
    smallImageKey: isPaused ? "pause" : "play",
    smallImageText: isPaused ? "Paused" : "Playing",
    instance: false
  };

  if (!isPaused && Number.isFinite(currentTime) && Number.isFinite(duration) && duration > 0) {
    activity.startTimestamp = now - Math.floor(currentTime * 1000);
    activity.endTimestamp = now + Math.floor((duration - currentTime) * 1000);
  }

  client.user?.setActivity(activity).catch(err => console.warn("[discord-rpc] setActivity failed:", err.message));
}

function setActivity(state) {
  lastState = state;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => applyActivity(lastState), ACTIVITY_DEBOUNCE_MS);

  // Paused for a while (not just skipping between tracks) — drop the presence rather
  // than showing a stale "Paused" card indefinitely.
  clearTimeout(pauseTimer);
  if (state.isPaused) {
    pauseTimer = setTimeout(clearActivity, PAUSE_CLEAR_DELAY_MS);
  }
}

function clearActivity() {
  lastState = null;
  clearTimeout(debounceTimer);
  clearTimeout(pauseTimer);
  if (client && ready) {
    client.user?.clearActivity().catch(() => {});
  }
}

function initDiscordRPC(configuredClientId) {
  clientId = configuredClientId || null;
  connect();
}

function destroyDiscordRPC() {
  clearTimeout(reconnectTimer);
  clearTimeout(debounceTimer);
  clearTimeout(pauseTimer);
  if (client) {
    client.destroy().catch(() => {});
    client = null;
  }
  ready = false;
}

module.exports = { initDiscordRPC, destroyDiscordRPC, setActivity, clearActivity };
