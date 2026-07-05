// Dev-only smoke test for the shell architecture: boots the BaseWindow shell,
// screenshots the Home screen, then opens the Files pane and screenshots that.
// Run: npm run smoke [-- <outdir>]
const { app, session } = require("electron");
const fs = require("fs");
const path = require("path");

const { createShellWindow } = require("../src/shell-window");
const { setupSession } = require("../src/session-setup");

const outDir = process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : path.join(__dirname, "..");

app.userAgentFallback = app.userAgentFallback
	.split(" ")
	.filter((t) => !t.startsWith("Electron/") && !t.toLowerCase().startsWith("murphy"))
	.join(" ");

const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
	setupSession(session.fromPartition("persist:murphy"));
	const { win, shellView, panes, showSection } = createShellWindow();
	app.isQuitting = true; // let close actually close in smoke mode

	shellView.webContents.on("console-message", (_e, level, message) => {
		if (level >= 3) errors.push("[shell] " + message);
	});

	shellView.webContents.on("did-finish-load", async () => {
		await sleep(2000);
		const home = await shellView.webContents.capturePage();
		fs.writeFileSync(path.join(outDir, "shell-home.png"), home.toPNG());
		console.log("HOME SHOT: shell-home.png");

		showSection("files");
		const pane = panes.get("files");
		pane.webContents.on("console-message", (_e, level, message) => {
			if (level >= 3) errors.push("[files] " + message);
		});
		await new Promise((resolve) => pane.webContents.once("did-finish-load", resolve));
		await sleep(3500);
		// Capture the whole window composition (rail + pane) via the shell view
		// for the chrome, and the pane contents separately.
		const paneShot = await pane.webContents.capturePage();
		fs.writeFileSync(path.join(outDir, "shell-files-pane.png"), paneShot.toPNG());
		console.log("FILES PANE URL: " + pane.webContents.getURL());
		console.log("FILES SHOT: shell-files-pane.png");
		console.log("PANE UA: " + (pane.webContents.getUserAgent().includes("Electron") ? "LEAKS ELECTRON" : "clean"));
		console.log("CONSOLE-ERRORS: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
		app.exit(0);
	});
});
