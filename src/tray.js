const { app, Menu, Tray } = require("electron");
const path = require("path");
const { showWindow } = require("./shell-window");
const { getSetting, setSetting } = require("./settings");

function createTray(getWindow, voiceMonitor) {
	const tray = new Tray(path.join(__dirname, "..", "build", "icon.png"));
	tray.setToolTip("Murphy Cloud");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open Murphy Cloud", click: () => showWindow(getWindow()) },
			{
				label: "In-call overlay",
				type: "checkbox",
				checked: getSetting("overlayEnabled"),
				click: (item) => {
					setSetting("overlayEnabled", item.checked);
					voiceMonitor.setOverlayEnabled(item.checked);
				},
			},
			{
				label: "Overlay name labels",
				submenu: ["always", "speaking", "never"].map((mode) => ({
					label: { always: "Always", speaking: "While speaking", never: "Never" }[mode],
					type: "radio",
					checked: (getSetting("overlayDisplayNames") || "speaking") === mode,
					click: () => voiceMonitor.setDisplayNames(mode), // setter persists
				})),
			},
			{
				label: "Overlay: only show speakers",
				type: "checkbox",
				checked: getSetting("overlayDisplayUsers") === "speaking",
				click: (item) => voiceMonitor.setDisplayUsers(item.checked ? "speaking" : "always"),
			},
			{
				// Windows-only effect (Chromium loopback); harmless elsewhere.
				label: "Share system audio when screensharing",
				type: "checkbox",
				checked: getSetting("shareSystemAudio"),
				click: (item) => setSetting("shareSystemAudio", item.checked),
			},
			{ type: "separator" },
			{
				label: "Quit",
				click: () => {
					app.isQuitting = true;
					app.quit();
				},
			},
		])
	);
	tray.on("click", () => showWindow(getWindow()));
	return tray;
}

module.exports = { createTray };
