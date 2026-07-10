const { BrowserWindow, Notification, ipcMain, screen } = require("electron");
const path = require("path");
const { getSetting, setSetting } = require("./settings");

const VOICE_STATE_URL = "https://murphy-cloud.com/apps/murphy_calls/voice-state";
const NC_USER_URL = "https://murphy-cloud.com/ocs/v2.php/cloud/user?format=json";
const AVATAR_URL = (localpart) => `https://murphy-cloud.com/avatar/${encodeURIComponent(localpart)}/64`;

const OVERLAY_H = 64; // avatar strip only
const OVERLAY_EXPANDED_H = 112; // strip + volume popover row

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
	let overlayEnabled = getSetting("overlayEnabled"); // tray toggle, persisted
	let overlayExpanded = false; // volume popover open → taller/wider window
	let stripWidth = 220; // width the avatar strip needs; popover may need more
	let overlayWanted = false; // last recomputeOverlay verdict (guards async sends)
	let lastRoom = null;
	let lastInCall = false;
	let lastPeople = []; // deduped participants from the last poll
	const avatarCache = new Map(); // localpart → Promise<dataURL|null>; cleared when call ends
	const volumeMap = new Map(Object.entries(getSetting("participantVolumes") || {})); // localpart → 0..1
	let volumeWarned = false;

	// In-call overlay: compact avatar strip floating over games (borderless/
	// windowed). Draggable; KWin remembers where the user parks it.
	function getOverlay() {
		if (overlay && !overlay.isDestroyed()) return overlay;
		const { workArea } = screen.getPrimaryDisplay();
		overlay = new BrowserWindow({
			width: 220,
			height: OVERLAY_H,
			x: workArea.x + 12,
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

	// One participant per person: voice-state lists every device/tab, keyed
	// here by matrix localpart from the id ("@cal:server:DEVICE" — this parse
	// must match the identity prefix in setParticipantVolume's snippet).
	function dedupe(participants) {
		const byUser = new Map();
		for (const p of participants || []) {
			const m = /^@([^:]+):/.exec(p.id || "");
			const localpart = (m ? m[1] : p.label || "?").toLowerCase();
			const prev = byUser.get(localpart);
			if (!prev || (p.speaking && !prev.speaking)) byUser.set(localpart, { ...p, localpart });
		}
		return [...byUser.values()];
	}

	function fetchAvatar(localpart) {
		if (avatarCache.has(localpart)) return avatarCache.get(localpart);
		const promise = (async () => {
			try {
				const r = await ses.fetch(AVATAR_URL(localpart), { credentials: "include" });
				if (!r.ok) return null;
				const type = r.headers.get("content-type") || "image/png";
				return `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
			} catch {
				return null; // renderer falls back to the initials bubble
			}
		})();
		avatarCache.set(localpart, promise);
		return promise;
	}

	function isShellFocused() {
		if (process.env.MURPHY_FAKE_FOCUSED === "1") return true; // harness override
		try {
			return shell.win.isFocused();
		} catch {
			return false;
		}
	}

	async function showOverlay(people) {
		const o = getOverlay();
		const shown = people.slice(0, 8);
		stripWidth = 24 + shown.length * 44 + 16;
		o.setContentSize(overlaySize()[0], overlaySize()[1]);
		const payload = await Promise.all(
			shown.map(async (p) => ({
				id: p.id,
				localpart: p.localpart,
				label: p.label,
				speaking: p.speaking,
				avatar: await fetchAvatar(p.localpart),
				volume: volumeMap.has(p.localpart) ? volumeMap.get(p.localpart) : 1,
				self: p.localpart === uid,
			}))
		);
		if (!overlayWanted || !overlay || overlay.isDestroyed()) return; // focus regained mid-fetch
		const send = () => {
			o.webContents.send("calloverlay:state", { participants: payload });
			if (!o.isVisible()) o.showInactive();
		};
		o.webContents.isLoading() ? o.webContents.once("did-finish-load", send) : send();
	}

	function hideOverlay() {
		if (overlay && !overlay.isDestroyed() && overlay.isVisible()) overlay.hide();
	}

	// Discord-style: the strip only floats while you're in a call and NOT
	// looking at the app (minimized, hidden to tray, or covered by a game).
	function recomputeOverlay() {
		overlayWanted = !!(lastRoom && lastInCall && overlayEnabled && !isShellFocused());
		if (overlayWanted) showOverlay(lastPeople);
		else hideOverlay();
	}

	// --- per-participant volume (Feature B) -------------------------------
	// EC 0.19.2 keeps remote <audio> in a hidden container with no identity
	// attr; walk each element's React fiber up to the trackRef and call
	// RemoteParticipant.setVolume() — the same sink EC's native tile slider
	// uses, durable across re-attach/renegotiation. Undocumented internals:
	// wrapped in try/catch, returns matched count (-1 on error).
	function ecFrame() {
		const wc = shell.panes?.get?.("chat")?.webContents;
		if (!wc || wc.isDestroyed()) return null;
		try {
			return wc.mainFrame.framesInSubtree().find((f) => f.url.includes("/widgets/element-call/")) || null;
		} catch {
			return null;
		}
	}

	async function setParticipantVolume(localpart, volume) {
		const frame = ecFrame();
		if (!frame) return 0;
		// prefix must match dedupe()'s localpart parse (identity = "@user:server:DEVICE")
		const js = `(() => { try {
			let matched = 0;
			for (const el of document.querySelectorAll('audio[data-lk-source]:not([data-lk-local-participant="true"])')) {
				const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
				let f = key && el[key];
				for (let i = 0; f && i < 8; i++, f = f.return) {
					const p = f.memoizedProps && f.memoizedProps.trackRef && f.memoizedProps.trackRef.participant;
					if (p && typeof p.identity === "string" && p.identity.toLowerCase().startsWith(${JSON.stringify(`@${localpart}:`)})) {
						if (typeof p.setVolume === "function") { p.setVolume(${Number(volume)}); matched++; }
						break;
					}
				}
			}
			return matched;
		} catch { return -1; } })()`;
		try {
			return await frame.executeJavaScript(js, true);
		} catch {
			return 0;
		}
	}

	// Reapply saved volumes each in-call poll tick: setVolume survives EC
	// re-renders within a session, but a fresh call starts at 1.0. Idempotent.
	async function applyAllVolumes(people) {
		let pending = 0;
		let matched = 0;
		for (const p of people) {
			if (p.localpart === uid || !volumeMap.has(p.localpart)) continue;
			const v = volumeMap.get(p.localpart);
			if (v === 1) continue;
			pending++;
			matched += Math.max(0, await setParticipantVolume(p.localpart, v));
		}
		if (pending > 0 && matched === 0 && !volumeWarned && ecFrame()) {
			volumeWarned = true; // one-time tripwire so a broken fiber walk isn't forever silent
			console.error(
				"[voice-monitor] volume injection matched no EC audio elements — EC internals may have changed; tile ⋮ menu still works"
			);
		}
	}

	ipcMain.on("calloverlay:set-volume", (_e, { localpart, volume } = {}) => {
		if (typeof localpart !== "string" || typeof volume !== "number" || Number.isNaN(volume)) return;
		const v = Math.min(1, Math.max(0, volume));
		volumeMap.set(localpart, v);
		setSetting("participantVolumes", Object.fromEntries(volumeMap));
		setParticipantVolume(localpart, v);
	});
	// Grow only while a popover is open — permanent transparent area would
	// eat mouse clicks meant for the game underneath. The popover pill is
	// wider than a short strip, so expanded mode also widens.
	function overlaySize() {
		return overlayExpanded
			? [Math.max(stripWidth, 240), OVERLAY_EXPANDED_H]
			: [stripWidth, OVERLAY_H];
	}
	ipcMain.on("calloverlay:resize", (_e, { expanded } = {}) => {
		overlayExpanded = !!expanded;
		if (overlay && !overlay.isDestroyed()) overlay.setContentSize(overlaySize()[0], overlaySize()[1]);
	});

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

			lastRoom = room;
			lastInCall = inCall;
			lastPeople = room ? dedupe(room.participants) : [];
			recomputeOverlay();
			if (room && inCall) applyAllVolumes(lastPeople);

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
				avatarCache.clear(); // transient fetch failures get one retry per call
			}
			setTimeout(poll, room ? 2500 : 4000);
		} catch {
			setTimeout(poll, 8000); // never let the monitor die
		}
	}

	// React between polls: minimize/blur → show instantly, refocus → hide.
	// Wayland doesn't reliably emit minimize/restore, so focus/blur carry the
	// feature (minimizing blurs first); the rest are belt-and-suspenders and
	// "hide" covers close-to-tray.
	if (typeof shell.win.on === "function") {
		for (const ev of ["focus", "blur", "minimize", "restore", "show", "hide"]) {
			shell.win.on(ev, recomputeOverlay);
		}
	}

	poll();

	return {
		setOverlayEnabled(v) {
			overlayEnabled = v;
			recomputeOverlay();
		},
	};
}

module.exports = { startVoiceMonitor };
