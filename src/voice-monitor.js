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
				!!room && !!selfPrefix && room.participants.some((p) => (p.id || "").toLowerCase().startsWith(selfPrefix));
			const viewingChat = shell.win.isFocused() && shell.getActiveSection() === "chat";

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
}

module.exports = { startVoiceMonitor };
