const { app, BaseWindow, WebContentsView, ipcMain } = require("electron");
const path = require("path");
const windowStateKeeper = require("electron-window-state");
const { applyNavPolicy } = require("./nav-policy");

const RAIL_WIDTH = 72; // must match the rail width in shell/src/Rail.jsx

const SECTION_URLS = {
	files: "https://murphy-cloud.com/apps/files/",
	chat: "https://element.murphy-cloud.com/",
	calls: "https://murphy-cloud.com/apps/murphy_calls/",
	photos: "https://murphy-cloud.com/apps/photos/",
	rosie: "https://rosie.murphy-cloud.com/",
};

function createShellWindow() {
	const state = windowStateKeeper({ defaultWidth: 1280, defaultHeight: 820 });

	const win = new BaseWindow({
		x: state.x,
		y: state.y,
		width: state.width,
		height: state.height,
		icon: path.join(__dirname, "..", "build", "icon.png"),
		backgroundColor: "#1a001a",
	});
	if (win.setMenuBarVisibility) win.setMenuBarVisibility(false);
	state.manage(win);

	// The shell (React rail + home screen) fills the whole window at the bottom
	// of the view stack; section panes are layered above it, right of the rail.
	const shellView = new WebContentsView({
		webPreferences: {
			preload: path.join(__dirname, "preload-shell.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	win.contentView.addChildView(shellView);
	shellView.webContents.loadFile(path.join(__dirname, "..", "shell", "dist", "index.html"));

	const panes = new Map();
	let active = "home";

	function layout() {
		const { width, height } = win.getContentBounds();
		shellView.setBounds({ x: 0, y: 0, width, height });
		const pane = panes.get(active);
		if (pane) pane.setBounds({ x: RAIL_WIDTH, y: 0, width: Math.max(0, width - RAIL_WIDTH), height });
	}

	function getPane(section) {
		if (panes.has(section)) return panes.get(section);
		const pane = new WebContentsView({
			webPreferences: {
				partition: "persist:murphy",
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		applyNavPolicy(pane.webContents);
		pane.webContents.loadURL(SECTION_URLS[section]);
		panes.set(section, pane);
		win.contentView.addChildView(pane);
		return pane;
	}

	function showSection(section) {
		if (section !== "home" && !SECTION_URLS[section]) return;
		const prev = panes.get(active);
		if (prev) prev.setVisible(false);
		active = section;
		if (section !== "home") {
			getPane(section).setVisible(true);
			layout();
		}
		shellView.webContents.send("murphy:section", section);
	}

	ipcMain.on("murphy:navigate", (_e, section) => showSection(section));
	win.on("resize", layout);
	layout();

	// Close (X) hides to tray; only tray Quit / before-quit really exits.
	win.on("close", (event) => {
		if (!app.isQuitting) {
			event.preventDefault();
			win.hide();
		}
	});

	return { win, shellView, panes, showSection };
}

function showWindow(win) {
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

module.exports = { createShellWindow, showWindow, SECTION_URLS, RAIL_WIDTH };
