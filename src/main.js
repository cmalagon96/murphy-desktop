const { app, session } = require("electron");
const { createShellWindow, showWindow } = require("./shell-window");
const { setupSession } = require("./session-setup");
const { createTray } = require("./tray");
const { startVoiceMonitor } = require("./voice-monitor");

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
	let shell = null;

	app.on("second-instance", () => {
		if (shell) showWindow(shell.win);
	});

	app.on("before-quit", () => {
		app.isQuitting = true;
	});

	// Window-all-closed never really happens (close hides to tray), but if the
	// window is ever destroyed, keep running in the tray rather than exiting.
	app.on("window-all-closed", () => {});

	app.whenReady().then(() => {
		const ses = session.fromPartition("persist:murphy");
		setupSession(ses);
		// Chromium flushes cookies lazily; a rough exit (crash, SIGKILL) can lose
		// the Nextcloud login. Flush periodically and on quit.
		setInterval(() => ses.cookies.flushStore().catch(() => {}), 5 * 60 * 1000);
		app.on("before-quit", () => ses.cookies.flushStore().catch(() => {}));
		shell = createShellWindow();
		const voiceMonitor = startVoiceMonitor(ses, shell);
		createTray(() => shell.win, voiceMonitor);

		app.on("activate", () => {
			if (shell) showWindow(shell.win);
		});
	});
}
