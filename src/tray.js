const { app, Menu, Tray } = require("electron");
const path = require("path");
const { showWindow } = require("./shell-window");

function createTray(getWindow, voiceMonitor) {
	const tray = new Tray(path.join(__dirname, "..", "build", "icon.png"));
	tray.setToolTip("Murphy Cloud");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open Murphy Cloud", click: () => showWindow(getWindow()) },
			{
				label: "In-call overlay",
				type: "checkbox",
				checked: true,
				click: (item) => voiceMonitor.setOverlayEnabled(item.checked),
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
