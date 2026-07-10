// Dev-only: renders the incoming-call popup with fake data and screenshots it.
// Run: MURPHY_FAKE_CALL=1 electron scripts/popup-check.js [outdir]
const { app, BrowserWindow, session } = require("electron");
const fs = require("fs");
const path = require("path");
const { startVoiceMonitor } = require("../src/voice-monitor");

const outDir = process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : path.join(__dirname, "..");

app.whenReady().then(() => {
	const stubShell = {
		win: { isFocused: () => false, on: () => {} },
		getActiveSection: () => "home",
		joinVoiceRoom: (id) => console.log("JOIN CLICKED FOR: " + id),
	};
	startVoiceMonitor(session.fromPartition("persist:murphy-popup-test"), stubShell);

	setTimeout(async () => {
		const popup = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("call-popup"));
		if (!popup) {
			console.log("POPUP NOT CREATED");
			app.exit(1);
		}
		const img = await popup.webContents.capturePage();
		fs.writeFileSync(path.join(outDir, "call-popup.png"), img.toPNG());
		console.log("POPUP VISIBLE: " + popup.isVisible());
		console.log("SHOT: call-popup.png");
		app.exit(0);
	}, 7000);
});
