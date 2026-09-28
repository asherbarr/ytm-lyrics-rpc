const { app, BrowserWindow, ipcMain, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");
const { initDiscordRPC, destroyDiscordRPC, setActivity, clearActivity } = require("./discord-rpc");
const { fetchSyncedLyrics } = require("./lyrics");
const { loadConfig, getConfigPath } = require("./config");
const { createTray } = require("./tray");

let mainWindow;

const PLAYING_STATE_FILE = path.join(os.homedir(), ".cache", "ytm-lyrics-rpc-idle-watchdog.last_playing");
fs.mkdirSync(path.dirname(PLAYING_STATE_FILE), { recursive: true });

app.setName("YouTube Music");
// Fractional/abnormal device-scale-factor reporting (observed as 0.75 devicePixelRatio
// in the webview) makes YTM's icon-asset lookup fail and render empty icon buttons.
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("high-dpi-support", "1");

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

Menu.setApplicationMenu(null);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: "YouTube Music",
    frame: false,
    icon: path.join(__dirname, "../../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../renderer/preload.js"),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Closing the window hides it instead of quitting, so YTM keeps playing/polling
  // in the background and Discord RPC keeps updating. Real exit only happens via
  // the tray "Quit" item (which sets app.isQuitting) or the OS killing the process.
  mainWindow.on("close", event => {
    if (app.isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  createTray(mainWindow);
}

const ADBLOCK_CACHE_FILE = path.join(app.getPath("userData"), "adblocker-engine.bin");

async function setupAdBlocker() {
  const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path: ADBLOCK_CACHE_FILE,
    read: fs.promises.readFile,
    write: fs.promises.writeFile
  });

  // The webview's session isn't created until it actually attaches, so this has to be
  // a standing listener rather than a one-shot call — catches it whenever it appears.
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      blocker.enableBlockingInSession(contents.session);
    }
  });
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    const config = loadConfig();

    if (!config.discordClientId) {
      console.warn(
        `[config] No Discord client ID set. Create a Discord application at ` +
          `https://discord.com/developers/applications, then put its Client ID into ` +
          `"discordClientId" in ${getConfigPath()}`
      );
    }

    await setupAdBlocker().catch(err => console.warn("[adblock] setup failed:", err.message));

    initDiscordRPC(config.discordClientId);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow.show();
    });
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    destroyDiscordRPC();
  });

  // The window is hidden, not destroyed, on close (see createWindow), so the app
  // stays alive in the tray on every platform including Linux/Windows.
  app.on("window-all-closed", () => {});

  ipcMain.on("player-state-update", (_event, state) => {
    if (!state || !state.title) {
      clearActivity();
      return;
    }
    setActivity(state);

    // Lets an external idle-watcher (claude-desktop-idle-watcher.sh) close the app
    // after N minutes of no actual playback, rather than just no CPU activity.
    if (!state.isPaused) {
      fs.writeFile(PLAYING_STATE_FILE, String(Date.now()), () => {});
    }
  });

  ipcMain.handle("fetch-lyrics", async (_event, query) => {
    try {
      return await fetchSyncedLyrics(query);
    } catch (err) {
      console.warn("[lyrics] fetch failed:", err.message);
      return null;
    }
  });

  // Custom titlebar controls (frame: false removes the native ones).
  ipcMain.on("window-minimize", () => mainWindow?.minimize());
  ipcMain.on("window-toggle-maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  // Goes through the existing 'close' handler above (hide-to-tray), not a separate path.
  ipcMain.on("window-close", () => mainWindow?.close());
}
