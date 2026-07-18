const { BrowserWindow, Notification, ipcMain, screen } = require("electron");
const path = require("path");
const { getSetting, setSetting } = require("./settings");

const VOICE_STATE_URL = "https://murphy-cloud.com/apps/murphy_calls/voice-state";
const KICK_URL = "https://murphy-cloud.com/apps/murphy_calls/kick";
const NC_USER_URL = "https://murphy-cloud.com/ocs/v2.php/cloud/user?format=json";
const AVATAR_URL = (localpart) => `https://murphy-cloud.com/avatar/${encodeURIComponent(localpart)}/64`;
const MATRIX_SERVER = "matrix.murphy-cloud.com"; // localpart → full mxid for Message/Block

const OVERLAY_H = 64; // avatar strip only
const NAME_ROW_H = 18; // extra height when name labels are enabled
const POPOVER_H = 48; // extra height while the volume popover row is open

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
	let displayNames = getSetting("overlayDisplayNames") || "speaking"; // "always"|"speaking"|"never"
	let displayUsers = getSetting("overlayDisplayUsers") || "always"; // "always"|"speaking"
	let overlayExpanded = false; // volume popover open → taller/wider window
	let stripWidth = 220; // width the avatar strip needs; popover may need more
	let overlayWanted = false; // last recomputeOverlay verdict (guards async sends)
	let lastRoom = null;
	let lastInCall = false;
	let lastPeople = []; // deduped participants from the last poll
	let viewerCanKick = false; // server-reported (NC admin group), from voice-state
	const avatarCache = new Map(); // localpart → Promise<dataURL|null>; cleared when call ends
	const volumeMap = new Map(Object.entries(getSetting("participantVolumes") || {})); // localpart → 0..2
	const mutedMap = new Map(Object.entries(getSetting("mutedParticipants") || {})); // localpart → true
	let volumeWarned = false;
	// Fast speaking signal: the server field lags a full poll (2.5s); LiveKit's
	// isSpeaking on the same participant objects the volume walk reaches is
	// live (~Discord's own 200ms VAD delay at a 250ms poll).
	const speakingMap = new Map(); // localpart → bool, overrides server field while present
	let speakingTimer = null; // runs only while the overlay is shown
	let speakingWarned = false;
	let speakingSelfWarned = false; // self-anchor is best-effort (experimental)
	let lastPayload = null; // last participants payload sent to the overlay

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

	// LiveKit signal wins while we have one; the server field covers the gaps
	// (fiber walk broken, participant not matched, harness runs without EC).
	function effectiveSpeaking(localpart, serverSpeaking) {
		return speakingMap.has(localpart) ? speakingMap.get(localpart) : !!serverSpeaking;
	}

	// Discord's "Display Users: Only While Speaking". Membership changes only
	// happen here (the slow poll) — never from the 250ms speaking push — so
	// the strip doesn't churn size at 4Hz. Falls back to everyone rather than
	// rendering an empty floating pill.
	function visiblePeople(people) {
		if (displayUsers !== "speaking") return people;
		const talking = people.filter((p) => p.localpart === uid || effectiveSpeaking(p.localpart, p.speaking));
		return talking.length ? talking : people;
	}

	async function showOverlay(people) {
		const o = getOverlay();
		const shown = visiblePeople(people).slice(0, 8);
		stripWidth = 24 + shown.length * (displayNames !== "never" ? 60 : 44) + 16;
		o.setContentSize(overlaySize()[0], overlaySize()[1]);
		const payload = await Promise.all(
			shown.map(async (p) => ({
				id: p.id,
				localpart: p.localpart,
				label: p.label,
				speaking: effectiveSpeaking(p.localpart, p.speaking),
				serverSpeaking: !!p.speaking,
				avatar: await fetchAvatar(p.localpart),
				volume: volumeMap.has(p.localpart) ? volumeMap.get(p.localpart) : 1,
				muted: mutedMap.get(p.localpart) === true,
				blocked: ignoredSet.has(`@${p.localpart}:${MATRIX_SERVER}`),
				self: p.localpart === uid,
			}))
		);
		if (!overlayWanted || !overlay || overlay.isDestroyed()) return; // focus regained mid-fetch
		lastPayload = payload;
		const viewerIsAdmin =
			viewerCanKick ||
			process.env.MURPHY_FAKE_ADMIN === "1" || // harness: show the Kick row
			(!!uid && (getSetting("callAdmins") || []).includes(uid));
		const send = () => {
			o.webContents.send("calloverlay:state", { participants: payload, displayNames, viewerIsAdmin });
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
		syncSpeakingTimer();
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
			if (p.localpart === uid) continue;
			// mute-for-me wins over the saved volume but never overwrites it
			const v = mutedMap.get(p.localpart) === true ? 0 : volumeMap.has(p.localpart) ? volumeMap.get(p.localpart) : 1;
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

	// --- live speaking ring ----------------------------------------------
	// Same fiber walk as setParticipantVolume, but read-only: collect every
	// remote participant's isSpeaking (audioLevel as a fallback for older
	// livekit-client builds). Identity → localpart parse must stay in main so
	// it can't drift from dedupe()'s.
	async function pollSpeakingOnce() {
		if (!overlayWanted) return;
		if (process.env.MURPHY_FAKE_SPEAKING === "1") {
			// harness: flip the non-speaking fake participant every second to
			// exercise the fast path without a live EC frame
			speakingMap.set("rosie", Math.floor(Date.now() / 1000) % 2 === 0);
			pushSpeakingUpdate();
			return;
		}
		const frame = ecFrame();
		if (!frame) return;
		const js = `(() => { try {
			const out = [];
			const speakingOf = (p) => p.isSpeaking === true || (typeof p.audioLevel === "number" && p.audioLevel > 0.02);
			for (const el of document.querySelectorAll('audio[data-lk-source]:not([data-lk-local-participant="true"])')) {
				const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
				let f = key && el[key];
				for (let i = 0; f && i < 8; i++, f = f.return) {
					const p = f.memoizedProps && f.memoizedProps.trackRef && f.memoizedProps.trackRef.participant;
					if (p && typeof p.identity === "string") {
						out.push([p.identity.toLowerCase(), speakingOf(p)]);
						break;
					}
				}
			}
			// self: your own mic has no playback <audio> element — anchor on any
			// local-flagged element (tile/video) and accept participant-shaped
			// props; identity parses to our own localpart so it merges like the rest
			let selfDone = false;
			for (const el of document.querySelectorAll('[data-lk-local-participant="true"]')) {
				if (selfDone) break;
				const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
				let f = key && el[key];
				for (let i = 0; f && i < 12; i++, f = f.return) {
					const props = f.memoizedProps || {};
					const p = (props.trackRef && props.trackRef.participant) || props.participant;
					if (p && p.isLocal === true && typeof p.identity === "string") {
						out.push([p.identity.toLowerCase(), speakingOf(p)]);
						selfDone = true;
						break;
					}
				}
			}
			return out;
		} catch { return null; } })()`;
		let pairs = null;
		try {
			pairs = await frame.executeJavaScript(js, true);
		} catch {}
		if (!Array.isArray(pairs)) return;
		const hasRemotes = lastPeople.some((p) => p.localpart !== uid);
		if (pairs.length === 0) {
			if (hasRemotes && !speakingWarned) {
				speakingWarned = true; // one-time tripwire, mirrors volumeWarned
				console.error(
					"[voice-monitor] speaking poll matched no EC audio elements — falling back to the slow server field"
				);
			}
			return; // speakingMap stays as-is/empty → server field drives the ring
		}
		speakingMap.clear();
		for (const [identity, speaking] of pairs) {
			const m = /^@([^:]+):/.exec(identity || "");
			if (!m) continue;
			const lp = m[1].toLowerCase();
			speakingMap.set(lp, speakingMap.get(lp) || speaking); // multi-device OR
		}
		if (!speakingSelfWarned && uid && speakingMap.size > 0 && !speakingMap.has(uid)) {
			speakingSelfWarned = true; // one-time: self ring degrades to the server field
			console.warn("[voice-monitor] self speaking anchor not found — own ring uses the slow server field");
		}
		pushSpeakingUpdate();
	}

	// Re-send only the speaking flags, and only on a transition: no avatar
	// refetch, no resize, no add/remove — those stay on the slow poll so the
	// strip never churns at 4Hz.
	function pushSpeakingUpdate() {
		if (!overlayWanted || !overlay || overlay.isDestroyed() || !lastPayload) return;
		let changed = false;
		for (const row of lastPayload) {
			const eff = effectiveSpeaking(row.localpart, row.serverSpeaking);
			if (row.speaking !== eff) {
				row.speaking = eff;
				changed = true;
			}
		}
		if (changed) overlay.webContents.send("calloverlay:state", { participants: lastPayload, displayNames });
	}

	function syncSpeakingTimer() {
		const want = overlayWanted && (!!ecFrame() || process.env.MURPHY_FAKE_SPEAKING === "1");
		if (want && !speakingTimer) speakingTimer = setInterval(pollSpeakingOnce, 250);
		if (!want && speakingTimer) {
			clearInterval(speakingTimer);
			speakingTimer = null;
			speakingMap.clear();
		}
	}

	ipcMain.on("calloverlay:set-volume", (_e, { localpart, volume } = {}) => {
		if (typeof localpart !== "string" || typeof volume !== "number" || Number.isNaN(volume)) return;
		const v = Math.min(2, Math.max(0, volume)); // Discord-style 0–200%
		volumeMap.set(localpart, v);
		setSetting("participantVolumes", Object.fromEntries(volumeMap));
		if (mutedMap.delete(localpart)) setSetting("mutedParticipants", Object.fromEntries(mutedMap)); // dragging volume implies unmute
		setParticipantVolume(localpart, v);
	});

	ipcMain.on("calloverlay:set-muted", (_e, { localpart, muted } = {}) => {
		if (typeof localpart !== "string") return;
		if (muted) mutedMap.set(localpart, true);
		else mutedMap.delete(localpart);
		setSetting("mutedParticipants", Object.fromEntries(mutedMap));
		setParticipantVolume(localpart, muted ? 0 : volumeMap.has(localpart) ? volumeMap.get(localpart) : 1);
	});

	ipcMain.on("calloverlay:message", (_e, { localpart } = {}) => {
		if (typeof localpart !== "string" || !/^[a-z0-9._=\-]+$/i.test(localpart)) return;
		shell.openDMWith?.(`@${localpart.toLowerCase()}:${MATRIX_SERVER}`);
	});

	// --- Block / Unblock (Matrix ignore list) -----------------------------
	// Element's own client does the work: the pinned build exposes
	// window.mxMatrixClientPeg (probed via scripts/element-probe.js), and
	// setIgnoredUsers is public matrix-js-sdk API. The chat pane always exists
	// while in a call — the call itself runs inside it.
	let ignoredSet = new Set(); // lowercased mxids, refreshed each in-call poll

	function chatPane() {
		const wc = shell.panes?.get?.("chat")?.webContents;
		return wc && !wc.isDestroyed() ? wc : null;
	}

	async function refreshIgnored() {
		const wc = chatPane();
		if (!wc) return;
		try {
			const list = await wc.executeJavaScript(
				`(() => { try {
					const c = window.mxMatrixClientPeg && window.mxMatrixClientPeg.get();
					return c ? c.getIgnoredUsers() : null;
				} catch { return null; } })()`,
				true
			);
			if (Array.isArray(list)) ignoredSet = new Set(list.map((u) => String(u).toLowerCase()));
		} catch {}
	}

	ipcMain.on("calloverlay:block", async (_e, { localpart, block } = {}) => {
		if (typeof localpart !== "string" || !/^[a-z0-9._=\-]+$/i.test(localpart)) return;
		const mxid = `@${localpart.toLowerCase()}:${MATRIX_SERVER}`;
		const wc = chatPane();
		if (!wc) return;
		const js = `(async () => { try {
			const c = window.mxMatrixClientPeg && window.mxMatrixClientPeg.get();
			if (!c) return "no-client";
			const list = c.getIgnoredUsers() || [];
			const has = list.includes(${JSON.stringify(mxid)});
			if (${!!block} && !has) await c.setIgnoredUsers([...list, ${JSON.stringify(mxid)}]);
			if (${!block} && has) await c.setIgnoredUsers(list.filter((u) => u !== ${JSON.stringify(mxid)}));
			return "ok";
		} catch (e) { return "err:" + (e && e.message); } })()`;
		try {
			const r = await wc.executeJavaScript(js, true);
			if (r !== "ok") console.error("[voice-monitor] block failed: " + r);
			else if (block) ignoredSet.add(mxid);
			else ignoredSet.delete(mxid);
		} catch {}
	});

	// Kick = LiveKit RemoveParticipant via the murphy_calls admin endpoint
	// (NC session cookie auth; server enforces the NC admin group). Removes
	// them from the call only — Matrix room membership is untouched.
	ipcMain.on("calloverlay:kick", async (_e, { localpart } = {}) => {
		if (typeof localpart !== "string" || !/^[a-z0-9._=\-]+$/i.test(localpart) || !lastRoom) return;
		try {
			const r = await ses.fetch(KICK_URL, {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ room: lastRoom.id, localpart: localpart.toLowerCase() }),
			});
			if (!r.ok) console.error("[voice-monitor] kick failed: HTTP " + r.status);
		} catch (e) {
			console.error("[voice-monitor] kick failed: " + (e && e.message));
		}
	});
	// Grow only while a popover is open — permanent transparent area would
	// eat mouse clicks meant for the game underneath. The popover pill is
	// wider than a short strip, so expanded mode also widens.
	function stripH() {
		return displayNames !== "never" ? OVERLAY_H + NAME_ROW_H : OVERLAY_H;
	}
	function overlaySize() {
		let [w, h] = overlayExpanded
			? [Math.max(stripWidth, 240), stripH() + POPOVER_H]
			: [stripWidth, stripH()];
		if (menuSize) {
			w = Math.max(w, menuSize[0] + 16);
			h = stripH() + menuSize[1] + 12;
		}
		return [w, h];
	}
	ipcMain.on("calloverlay:resize", (_e, { expanded } = {}) => {
		overlayExpanded = !!expanded;
		if (overlay && !overlay.isDestroyed()) overlay.setContentSize(overlaySize()[0], overlaySize()[1]);
	});
	// Context menu open/close — renderer measures its menu, window grows to fit.
	// Same "grow only while open" rationale as the popover: a permanently big
	// transparent window would eat clicks meant for the game.
	let menuSize = null; // [w, h] while open
	ipcMain.on("calloverlay:menu-resize", (_e, { open, width, height } = {}) => {
		menuSize = open ? [Math.min(400, Number(width) || 0), Math.min(500, Number(height) || 0)] : null;
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
				viewerCanKick = state.viewerCanKick === true;
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
			if (room && inCall) {
				applyAllVolumes(lastPeople);
				refreshIgnored();
			}

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
				speakingMap.clear();
				lastPayload = null;
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
		setDisplayNames(mode) {
			displayNames = mode;
			setSetting("overlayDisplayNames", mode);
			recomputeOverlay();
		},
		setDisplayUsers(mode) {
			displayUsers = mode;
			setSetting("overlayDisplayUsers", mode);
			recomputeOverlay();
		},
	};
}

module.exports = { startVoiceMonitor };
