// Dev-only: verifies the Voice Lounge flow + legacy-button removal.
// Screenshots: home (rail), the NIDGAF chat header, and the Lounge join screen.
// Run with the packaged app CLOSED: MURPHY_PROFILE="~/.config/Murphy Desktop" electron scripts/lounge-check.js [outdir]
const { app, session } = require("electron");
const fs = require("fs");
const path = require("path");

const { createShellWindow } = require("../src/shell-window");
const { setupSession } = require("../src/session-setup");

const outDir = process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : path.join(__dirname, "..");
if (process.env.MURPHY_PROFILE) app.setPath("userData", process.env.MURPHY_PROFILE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
	setupSession(session.fromPartition("persist:murphy"));
	const { panes, showSection, shellView } = createShellWindow();
	app.isQuitting = true;

	await new Promise((r) => shellView.webContents.once("did-finish-load", r));
	await sleep(1500);
	fs.writeFileSync(path.join(outDir, "lc-home.png"), (await shellView.webContents.capturePage()).toPNG());

	// Chat first: element boots + silent SSO; NIDGAF header should have no call buttons
	showSection("chat");
	const pane = panes.get("chat");
	await new Promise((r) => pane.webContents.once("did-finish-load", r));
	await sleep(12000); // element initial sync
	fs.writeFileSync(path.join(outDir, "lc-chat.png"), (await pane.webContents.capturePage()).toPNG());
	console.log("CHAT URL: " + pane.webContents.getURL());

	// Now the Lounge (SPA hash-hop)
	showSection("lounge");
	await sleep(9000); // room resolve + EC widget boot
	fs.writeFileSync(path.join(outDir, "lc-lounge.png"), (await pane.webContents.capturePage()).toPNG());
	console.log("LOUNGE URL: " + pane.webContents.getURL());
	console.log("DONE");
	app.exit(0);
});
