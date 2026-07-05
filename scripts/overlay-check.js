// Dev-only: renders the in-call overlay strip with fake data and screenshots it.
// Run: MURPHY_FAKE_CALL=1 MURPHY_FAKE_INCALL=1 electron scripts/overlay-check.js [outdir]
const { app, BrowserWindow, session } = require("electron");
const fs = require("fs");
const path = require("path");
const { startVoiceMonitor } = require("../src/voice-monitor");

const outDir = process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : path.join(__dirname, "..");

app.whenReady().then(() => {
	const stubShell = {
		win: { isFocused: () => false },
		getActiveSection: () => "home",
		joinVoiceRoom: () => {},
	};
	startVoiceMonitor(session.fromPartition("persist:murphy-overlay-test"), stubShell);

	setTimeout(async () => {
		const overlay = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("call-overlay"));
		if (!overlay) {
			console.log("OVERLAY NOT CREATED");
			app.exit(1);
		}
		const img = await overlay.webContents.capturePage();
		fs.writeFileSync(path.join(outDir, "call-overlay.png"), img.toPNG());
		console.log("OVERLAY VISIBLE: " + overlay.isVisible());
		console.log("SHOT: call-overlay.png");
		app.exit(0);
	}, 7000);
});
