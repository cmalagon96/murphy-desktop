// Dev-only: opens the overlay with fake data, right-clicks a bubble, and
// screenshots the context menu. Dispatches the contextmenu event directly —
// deterministic regardless of where the real cursor is.
// Run: MURPHY_FAKE_CALL=1 MURPHY_FAKE_INCALL=1 electron scripts/overlay-menu-check.js [outdir]
const { app, BrowserWindow, session } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

// isolated profile: the mute click below persists settings, and dev runs
// shouldn't leave state behind for the next harness run
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "murphy-menu-check-")));
const { startVoiceMonitor } = require("../src/voice-monitor");

const outDir = process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : path.join(__dirname, "..");

app.whenReady().then(() => {
	const stubShell = {
		win: { isFocused: () => false, on: () => {} }, // unfocused → overlay shows
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
		const opened = await overlay.webContents.executeJavaScript(`(() => {
			const bubbles = document.querySelectorAll(".bubble");
			if (!bubbles.length) return "no-bubbles";
			bubbles[bubbles.length - 1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
			return document.getElementById("menu").hidden ? "menu-hidden" : "menu-open";
		})()`);
		await new Promise((r) => setTimeout(r, 600)); // let the resize land
		const [w, h] = overlay.getContentSize();
		const img = await overlay.webContents.capturePage();
		fs.writeFileSync(path.join(outDir, "call-overlay-menu.png"), img.toPNG());
		console.log("MENU: " + opened);
		console.log("WINDOW: " + w + "x" + h);
		console.log("SHOT: call-overlay-menu.png");

		// Full mute round-trip: menu click → IPC → settings → next slow poll
		// re-sends state with muted:true → badge appears on the cell.
		await overlay.webContents.executeJavaScript(`(() => {
			const rows = [...document.querySelectorAll("#menu .mi")];
			const mute = rows.find((r) => r.textContent.trim() === "Mute");
			if (mute) mute.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return !!mute;
		})()`);
		await new Promise((r) => setTimeout(r, 3200)); // > one 2.5s poll tick
		const muted = await overlay.webContents.executeJavaScript(
			`document.querySelectorAll(".cell.muted").length`
		);
		const img2 = await overlay.webContents.capturePage();
		fs.writeFileSync(path.join(outDir, "call-overlay-muted.png"), img2.toPNG());
		console.log("MUTED CELLS: " + muted);
		console.log("SHOT: call-overlay-muted.png");
		app.exit(opened === "menu-open" && muted === 1 ? 0 : 1);
	}, 6500);
});
