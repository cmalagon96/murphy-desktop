const { app, session } = require("electron");
const { createMainWindow, showWindow } = require("./window-manager");
const { setupSession } = require("./session-setup");
const { createTray } = require("./tray");

app.setAppUserModelId("com.murphycloud.desktop");
// Default-on when Wayland is detected on current Chromium; harmless insurance.
app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");

// Some requests fire before the persist:murphy session is first touched —
// scrub the fallback UA early too (same filter as session-setup).
app.userAgentFallback = app.userAgentFallback
	.split(" ")
	.filter((t) => !t.startsWith("Electron/") && !t.toLowerCase().startsWith("murphy"))
	.join(" ");

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	let mainWindow = null;

	app.on("second-instance", () => {
		if (mainWindow) showWindow(mainWindow);
	});

	app.on("before-quit", () => {
		app.isQuitting = true;
	});

	// Window-all-closed never really happens (close hides to tray), but if the
	// window is ever destroyed, keep running in the tray rather than exiting.
	app.on("window-all-closed", () => {});

	app.whenReady().then(() => {
		setupSession(session.fromPartition("persist:murphy"));
		mainWindow = createMainWindow();
		createTray(() => mainWindow);

		app.on("activate", () => {
			if (mainWindow) showWindow(mainWindow);
		});
	});
}
