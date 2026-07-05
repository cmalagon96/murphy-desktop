const { app, BaseWindow, WebContentsView, ipcMain } = require("electron");
const path = require("path");
const windowStateKeeper = require("electron-window-state");
const { applyNavPolicy } = require("./nav-policy");

const RAIL_WIDTH = 72; // must match the rail width in shell/src/Rail.jsx

const SECTION_URLS = {
	files: "https://murphy-cloud.com/apps/files/",
	chat: "https://element.murphy-cloud.com/",
	photos: "https://murphy-cloud.com/apps/photos/",
	rosie: "https://rosie.murphy-cloud.com/",
};

// Element Web allows only ONE instance per profile ("connected in another
// tab"). The murphy_calls page embeds the same Element, so a separate Calls
// pane can never coexist with Chat — calls live inside the Element pane
// (the Discord-style call UI is patched into its bundled Element Call).
const SECTION_ALIAS = { calls: "chat" };

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
	wireReloadKeys(shellView.webContents);

	const panes = new Map();
	let active = "home";

	function layout() {
		const { width, height } = win.getContentBounds();
		shellView.setBounds({ x: 0, y: 0, width, height });
		const pane = panes.get(active);
		if (pane) pane.setBounds({ x: RAIL_WIDTH, y: 0, width: Math.max(0, width - RAIL_WIDTH), height });
	}

	// Synapse renders OIDC errors (missing_session/mismatching_session) at the
	// callback URL. Users never legitimately *land* there — success 302s on to
	// Element — so a committed navigation to it means a broken SSO hop. The
	// classic cause here: two Element surfaces (Chat pane + Calls iframe) racing
	// the dance in one cookie jar. Retrying after the winner finishes succeeds.
	const SSO_ERROR_URL = /^https:\/\/matrix\.murphy-cloud\.com\/_synapse\/client\/oidc\/callback/;

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
		wireReloadKeys(pane.webContents);

		let ssoRetryAt = 0;
		const maybeRecoverSSO = (url) => {
			if (!SSO_ERROR_URL.test(url)) return;
			const now = Date.now();
			if (now - ssoRetryAt < 60_000) return; // one retry, no loops
			ssoRetryAt = now;
			setTimeout(() => pane.webContents.loadURL(SECTION_URLS[section]), 1500);
		};
		pane.webContents.on("did-navigate", (_e, url) => maybeRecoverSSO(url));
		pane.webContents.on("did-frame-navigate", (_e, url, _code, _status, isMainFrame) => {
			if (!isMainFrame) maybeRecoverSSO(url); // Calls: error renders inside the murphy_calls iframe
		});

		pane.webContents.loadURL(SECTION_URLS[section]);
		panes.set(section, pane);
		win.contentView.addChildView(pane);
		return pane;
	}

	// Ctrl/Cmd+R and F5 reload the active pane back to its section root (a
	// plain reload would re-request the failed SSO callback URL itself).
	function reloadActive() {
		if (active === "home") return;
		const pane = panes.get(active);
		if (pane) pane.webContents.loadURL(SECTION_URLS[active]);
	}

	function wireReloadKeys(wc) {
		wc.on("before-input-event", (event, input) => {
			if (input.type !== "keyDown") return;
			if ((input.key.toLowerCase() === "r" && (input.control || input.meta)) || input.key === "F5") {
				event.preventDefault();
				reloadActive();
			}
		});
	}

	function showSection(section) {
		section = SECTION_ALIAS[section] || section;
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
