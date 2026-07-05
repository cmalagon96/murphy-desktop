const { app, Menu, Tray } = require("electron");
const path = require("path");
const { showWindow } = require("./window-manager");

function createTray(getWindow) {
	const tray = new Tray(path.join(__dirname, "..", "build", "icon.png"));
	tray.setToolTip("Murphy Cloud");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open Murphy Cloud", click: () => showWindow(getWindow()) },
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
