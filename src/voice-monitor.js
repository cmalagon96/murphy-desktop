const { BrowserWindow, Notification, ipcMain, screen } = require("electron");
const path = require("path");

const VOICE_STATE_URL = "https://murphy-cloud.com/apps/murphy_calls/voice-state";
const NC_USER_URL = "https://murphy-cloud.com/ocs/v2.php/cloud/user?format=json";

// Polls the murphy_calls voice-state endpoint (NC-session cookies via
// ses.fetch) and pops an always-on-top "X is in a voice call — Join" card
// when a call is live that the user is neither in nor already looking at.
function startVoiceMonitor(ses, shell) {
	let uid = null; // NC user id, lowercased = matrix localpart
	let popup = null;
	const dismissed = new Set(); // room ids muted until the call ends
	const notified = new Set(); // room ids already OS-notified this call

	async function ncUser() {
		try {
			const r = await ses.fetch(NC_USER_URL, {
				headers: { "OCS-APIRequest": "true" },
				credentials: "include",
			});
			if (!r.ok) return null;
			return ((await r.json()).ocs?.data?.id || "").toLowerCase() || null;
		} catch {
			return null;
		}
	}

	function getPopup() {
		if (popup && !popup.isDestroyed()) return popup;
		const { workArea } = screen.getPrimaryDisplay();
		popup = new BrowserWindow({
			width: 380,
			height: 82,
			x: workArea.x + workArea.width - 396,
			y: workArea.y + workArea.height - 98,
			frame: false,
			transparent: true,
			resizable: false,
			alwaysOnTop: true,
			skipTaskbar: true,
			show: false,
			webPreferences: {
				preload: path.join(__dirname, "call-popup-preload.js"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		popup.setAlwaysOnTop(true, "screen-saver");
		popup.loadFile(path.join(__dirname, "call-popup.html"));
		return popup;
	}

	let currentRoom = null;
	let overlay = null;
	let overlayEnabled = true; // tray toggle

	// In-call overlay: compact avatar strip floating over games (borderless/
	// windowed). Draggable; KWin remembers where the user parks it.
	function getOverlay() {
		if (overlay && !overlay.isDestroyed()) return overlay;
		const { workArea } = screen.getPrimaryDisplay();
		overlay = new BrowserWindow({
			width: 220,
			height: 64,
			x: workArea.x + Math.round(workArea.width / 2) - 110,
			y: workArea.y + 12,
			frame: false,
			transparent: true,
			resizable: false,
			alwaysOnTop: true,
			skipTaskbar: true,
			show: false,
			webPreferences: {
				preload: path.join(__dirname, "call-overlay-preload.js"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		overlay.setAlwaysOnTop(true, "screen-saver");
		overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		overlay.loadFile(path.join(__dirname, "call-overlay.html"));
		return overlay;
	}

	function showOverlay(room) {
		const o = getOverlay();
		const n = Math.min(room.participants.length, 8);
		o.setContentSize(24 + n * 44 + 16, 64);
		const send = () => {
			o.webContents.send("calloverlay:state", { participants: room.participants });
			if (!o.isVisible()) o.showInactive();
		};
		o.webContents.isLoading() ? o.webContents.once("did-finish-load", send) : send();
	}

	function hideOverlay() {
		if (overlay && !overlay.isDestroyed() && overlay.isVisible()) overlay.hide();
	}

	ipcMain.on("callpopup:join", () => {
		if (currentRoom) shell.joinVoiceRoom(currentRoom.id);
		if (popup && !popup.isDestroyed()) popup.hide();
	});
	ipcMain.on("callpopup:dismiss", () => {
		if (currentRoom) dismissed.add(currentRoom.id);
		if (popup && !popup.isDestroyed()) popup.hide();
	});

	function notify(room) {
		if (!Notification.isSupported()) return;
		const names = room.participants.map((p) => p.label).join(", ");
		const n = new Notification({
			title: "Voice call started",
			body: `${names} — click to join`,
			icon: path.join(__dirname, "..", "build", "icon.png"),
		});
		n.on("click", () => shell.joinVoiceRoom(room.id));
		n.show();
	}

	async function poll() {
		try {
			if (!uid) uid = await ncUser();
			let state = { rooms: [] };
			try {
				const r = await ses.fetch(VOICE_STATE_URL, { credentials: "include" });
				if (r.ok) state = await r.json();
			} catch {}

			if (process.env.MURPHY_FAKE_CALL) {
				state = {
					rooms: [{ id: "!fake:matrix.murphy-cloud.com", participants: [
						{ id: "@fortis:matrix.murphy-cloud.com:DEV", label: "Fortis", speaking: true },
						{ id: "@rosie:matrix.murphy-cloud.com:DEV", label: "Rosie", speaking: false },
					] }],
				};
			}

			const rooms = (state.rooms || []).filter((r) => (r.participants || []).length > 0);
			const room = rooms[0] || null;
			const selfPrefix = uid ? `@${uid}:` : null;
			const inCall =
				process.env.MURPHY_FAKE_INCALL === "1" ||
				(!!room && !!selfPrefix && room.participants.some((p) => (p.id || "").toLowerCase().startsWith(selfPrefix)));
			const viewingChat =
				shell.win.isFocused() && ["chat", "lounge"].includes(shell.getActiveSection());

			if (room && inCall && overlayEnabled) showOverlay(room);
			else hideOverlay();

			if (room && !inCall && !viewingChat && !dismissed.has(room.id)) {
				currentRoom = room;
				const p = getPopup();
				const send = () => {
					p.webContents.send("callpopup:state", { participants: room.participants });
					if (!p.isVisible()) p.showInactive();
				};
				p.webContents.isLoading() ? p.webContents.once("did-finish-load", send) : send();
				if (!notified.has(room.id)) {
					notified.add(room.id);
					notify(room);
				}
			} else {
				currentRoom = null;
				if (popup && !popup.isDestroyed() && popup.isVisible()) popup.hide();
			}
			if (!room) {
				notified.clear();
				dismissed.clear();
			}
			setTimeout(poll, room ? 2500 : 4000);
		} catch {
			setTimeout(poll, 8000); // never let the monitor die
		}
	}

	poll();

	return {
		setOverlayEnabled(v) {
			overlayEnabled = v;
			if (!v) hideOverlay();
		},
	};
}

module.exports = { startVoiceMonitor };
