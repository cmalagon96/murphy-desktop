// Dev-only: verifies the Matrix SSO flow completes in the Chat and Calls panes.
const { app, session } = require("electron");
const fs = require("fs");
const path = require("path");

const { createShellWindow } = require("../src/shell-window");
const { setupSession } = require("../src/session-setup");

const outDir = process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.userAgentFallback = app.userAgentFallback
	.split(" ")
	.filter((t) => !t.startsWith("Electron/") && !t.toLowerCase().startsWith("murphy"))
	.join(" ");

async function settle(pane, ms) {
	await new Promise((resolve) => {
		const done = () => resolve();
		pane.webContents.once("did-finish-load", done);
		setTimeout(done, 15000);
	});
	await sleep(ms);
}

app.whenReady().then(async () => {
	setupSession(session.fromPartition("persist:murphy"));
	const { panes, showSection } = createShellWindow();
	app.isQuitting = true;

	showSection("chat");
	const chat = panes.get("chat");
	await settle(chat, 9000); // element boot + silent SSO + initial sync
	const chatUrl = chat.webContents.getURL();
	fs.writeFileSync(path.join(outDir, "sso-chat.png"), (await chat.webContents.capturePage()).toPNG());
	console.log("CHAT URL: " + chatUrl);
	console.log("CHAT: " + (/^https:\/\/element\.murphy-cloud\.com/.test(chatUrl) ? "OK (on element)" : "PROBLEM"));

	showSection("calls");
	const calls = panes.get("calls");
	await settle(calls, 9000);
	const callsUrl = calls.webContents.getURL();
	fs.writeFileSync(path.join(outDir, "sso-calls.png"), (await calls.webContents.capturePage()).toPNG());
	console.log("CALLS URL: " + callsUrl);
	console.log("CALLS: " + (/^https:\/\/murphy-cloud\.com/.test(callsUrl) ? "OK (on murphy_calls)" : "PROBLEM"));
	app.exit(0);
});
