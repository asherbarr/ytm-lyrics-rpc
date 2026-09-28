const { Tray, Menu, app } = require("electron");
const path = require("path");

let tray = null;

function createTray(mainWindow) {
  tray = new Tray(path.join(__dirname, "../../build/tray_icon.png"));
  tray.setToolTip("YouTube Music");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => mainWindow.show()
    },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });

  return tray;
}

module.exports = { createTray };
