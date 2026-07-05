// Dev-only: verifies the login background is actually animating.
// Captures a background-only region twice, 1.6s apart, and compares pixels.
const { app, session } = require("electron");

const { createMainWindow } = require("../src/window-manager");
const { setupSession } = require("../src/session-setup");

const REGION = { x: 0, y: 0, width: 320, height: 420 }; // left edge: pure background, no caret

app.whenReady().then(async () => {
	const ses = session.fromPartition("persist:murphy");
	setupSession(ses);
	await ses.clearCache(); // drop any stale customcss (max-age=86400)
	const win = createMainWindow();
	app.isQuitting = true;

	win.webContents.on("did-finish-load", async () => {
		await new Promise((r) => setTimeout(r, 4000)); // let the 8MB gif load + start
		const a = (await win.webContents.capturePage(REGION)).toBitmap();
		await new Promise((r) => setTimeout(r, 1600));
		const b = (await win.webContents.capturePage(REGION)).toBitmap();
		let diff = 0;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
		const pct = ((diff / a.length) * 100).toFixed(1);
		console.log(`changed bytes: ${pct}%`);
		console.log(pct > 0.5 ? "BACKGROUND IS ANIMATING" : "BACKGROUND LOOKS STATIC");
		app.exit(pct > 0.5 ? 0 : 1);
	});
});
