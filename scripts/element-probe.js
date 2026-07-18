// Dev-only: probes the running Element Web build for the APIs the overlay's
// Block feature depends on (window.mxMatrixClientPeg → setIgnoredUsers).
// Read-only — makes no Matrix calls that change state.
// Run with the packaged app CLOSED:
//   MURPHY_PROFILE="$HOME/.config/Murphy Desktop" electron scripts/element-probe.js
const { app, BrowserWindow, session } = require("electron");

if (process.env.MURPHY_PROFILE) app.setPath("userData", process.env.MURPHY_PROFILE);

app.whenReady().then(() => {
	const win = new BrowserWindow({
		width: 1100,
		height: 800,
		show: false,
		webPreferences: {
			partition: "persist:murphy",
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	win.loadURL("https://element.murphy-cloud.com/");

	const deadline = Date.now() + 45000;
	const timer = setInterval(async () => {
		if (Date.now() > deadline) {
			try {
				const diag = await win.webContents.executeJavaScript(`(() => ({
					url: location.href,
					title: document.title,
					mxGlobals: Object.keys(window).filter((k) => /^mx/i.test(k)).slice(0, 20),
					bodySnippet: (document.body.innerText || "").slice(0, 200),
				}))()`, true);
				console.log("DIAG: " + JSON.stringify(diag));
				const fs = require("fs");
				fs.writeFileSync("/tmp/element-probe.png", (await win.webContents.capturePage()).toPNG());
				console.log("SHOT: /tmp/element-probe.png");
			} catch (e) {
				console.log("DIAG FAILED: " + e.message);
			}
			console.log("PROBE: timeout — mxMatrixClientPeg never appeared (Element may not be logged in)");
			clearInterval(timer);
			return app.exit(1);
		}
		try {
			const r = await win.webContents.executeJavaScript(`(() => {
				const peg = window.mxMatrixClientPeg;
				if (!peg || typeof peg.get !== "function") return { peg: false };
				const c = peg.get();
				if (!c) return { peg: true, client: false };
				return {
					peg: true,
					client: true,
					userId: typeof c.getUserId === "function" ? c.getUserId() : null,
					getIgnoredUsers: typeof c.getIgnoredUsers,
					setIgnoredUsers: typeof c.setIgnoredUsers,
					isUserIgnored: typeof c.isUserIgnored,
					synced: typeof c.getSyncState === "function" ? c.getSyncState() : null,
				};
			})()`, true);
			if (r && r.client) {
				console.log("PROBE: " + JSON.stringify(r));
				clearInterval(timer);
				return app.exit(0);
			}
			if (r && r.peg) console.log("peg present, client not ready yet…");
		} catch {}
	}, 1500);
});
