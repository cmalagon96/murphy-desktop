// Dev-only smoke test: boots the real window stack, waits for murphy-cloud.com
// to render, screenshots it, prints UA/title/console errors, and exits.
// Run: npm run smoke [-- <output.png>]
const { app, session } = require("electron");
const fs = require("fs");
const path = require("path");

const { createMainWindow } = require("../src/window-manager");
const { setupSession } = require("../src/session-setup");

const outPath = process.argv[2] && process.argv[2].endsWith(".png")
	? process.argv[2]
	: path.join(__dirname, "..", "smoke.png");

app.userAgentFallback = app.userAgentFallback
	.split(" ")
	.filter((t) => !t.startsWith("Electron/") && !t.toLowerCase().startsWith("murphy"))
	.join(" ");

const errors = [];

app.whenReady().then(() => {
	const ses = session.fromPartition("persist:murphy");
	setupSession(ses);
	const win = createMainWindow();
	app.isQuitting = true; // let close actually close in smoke mode

	win.webContents.on("console-message", (_e, level, message) => {
		if (level >= 3) errors.push(message);
	});

	win.webContents.on("did-finish-load", async () => {
		await new Promise((r) => setTimeout(r, 3500)); // let fonts/theme settle
		const image = await win.webContents.capturePage();
		fs.writeFileSync(outPath, image.toPNG());
		console.log("TITLE: " + win.webContents.getTitle());
		console.log("URL:   " + win.webContents.getURL());
		console.log("UA:    " + ses.getUserAgent());
		console.log("SHOT:  " + outPath);
		console.log("CONSOLE-ERRORS: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
		app.exit(0);
	});

	win.webContents.on("did-fail-load", (_e, code, desc, url) => {
		console.error(`LOAD FAILED ${code} ${desc} ${url}`);
		app.exit(1);
	});
});
