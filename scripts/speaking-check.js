// Dev-only: verifies the 250ms speaking poll drives ring transitions without
// re-rendering the strip. MURPHY_FAKE_SPEAKING flips Rosie's speaking state
// every second, so two samples 1s apart must differ (Fortis stays lit from
// the server field the whole time).
// Run: MURPHY_FAKE_CALL=1 MURPHY_FAKE_INCALL=1 MURPHY_FAKE_SPEAKING=1 electron scripts/speaking-check.js
const { app, BrowserWindow, session } = require("electron");
const { startVoiceMonitor } = require("../src/voice-monitor");

app.whenReady().then(() => {
	const stubShell = {
		win: { isFocused: () => false, on: () => {} },
		getActiveSection: () => "home",
		joinVoiceRoom: () => {},
	};
	startVoiceMonitor(session.fromPartition("persist:murphy-overlay-test"), stubShell);

	setTimeout(async () => {
		const overlay = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("call-overlay"));
		if (!overlay) {
			console.log("OVERLAY NOT CREATED");
			return app.exit(1);
		}
		const count = () => overlay.webContents.executeJavaScript(`document.querySelectorAll(".bubble.speaking").length`);
		const a = await count();
		await new Promise((r) => setTimeout(r, 1000));
		const b = await count();
		console.log(`SPEAKING COUNTS: ${a} -> ${b}`);
		// Rosie flips each second: one sample sees 1 (Fortis), the other 2
		app.exit(a !== b && a >= 1 && b >= 1 ? 0 : 1);
	}, 6500);
});
