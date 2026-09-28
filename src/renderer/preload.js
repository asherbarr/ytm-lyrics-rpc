const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("api", {
  sendPlayerState: state => ipcRenderer.send("player-state-update", state),
  fetchLyrics: query => ipcRenderer.invoke("fetch-lyrics", query),
  setZoomFactor: factor => webFrame.setZoomFactor(factor),
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  toggleMaximizeWindow: () => ipcRenderer.send("window-toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window-close")
});
