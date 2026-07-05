const { app, BrowserWindow } = require("electron");
const path = require("path");
const windowStateKeeper = require("electron-window-state");
const { applyNavPolicy } = require("./nav-policy");

const HOME_URL = "https://murphy-cloud.com";

function createMainWindow() {
	const state = windowStateKeeper({ defaultWidth: 1280, defaultHeight: 820 });

	const win = new BrowserWindow({
		x: state.x,
		y: state.y,
		width: state.width,
		height: state.height,
		icon: path.join(__dirname, "..", "build", "icon.png"),
		backgroundColor: "#1a001a",
		autoHideMenuBar: true,
		webPreferences: {
			partition: "persist:murphy",
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	state.manage(win);
	applyNavPolicy(win);

	// Close (X) hides to tray; only tray Quit / before-quit really exits.
	win.on("close", (event) => {
		if (!app.isQuitting) {
			event.preventDefault();
			win.hide();
		}
	});

	win.loadURL(HOME_URL);
	return win;
}

function showWindow(win) {
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

module.exports = { createMainWindow, showWindow, HOME_URL };
