// Dev-only: verifies the login background is actually animating.
// Standalone (own BrowserWindow) so it doesn't depend on the shell modules.
const { app, BrowserWindow, session } = require("electron");
const { setupSession } = require("../src/session-setup");

const REGION = { x: 0, y: 0, width: 320, height: 420 }; // left edge: pure background, no caret

app.whenReady().then(async () => {
	const ses = session.fromPartition("persist:murphy");
	setupSession(ses);
	await ses.clearCache();
	const win = new BrowserWindow({
		width: 1280,
		height: 820,
		webPreferences: { partition: "persist:murphy", contextIsolation: true, sandbox: true },
	});
	win.loadURL("https://murphy-cloud.com");

	win.webContents.on("did-finish-load", async () => {
		await new Promise((r) => setTimeout(r, 4000));
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
