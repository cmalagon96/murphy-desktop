const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
	overlayEnabled: true, // tray "In-call overlay" checkbox
	shareSystemAudio: false, // tray "Share system audio when screensharing" (win32 loopback)
	participantVolumes: {}, // matrix localpart → 0..2, set from the overlay widget
	mutedParticipants: {}, // matrix localpart → true: mute-for-me, keeps the saved volume intact
	overlayDisplayNames: "speaking", // overlay name labels: "always" | "speaking" | "never"
	overlayDisplayUsers: "always", // "speaking" = overlay shows only users who are talking
	callAdmins: [], // localparts shown the Kick action (fallback gate; server check preferred)
};

let settings = null; // lazy: userData path isn't reliable before app is ready

function file() {
	return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
	if (settings) return settings;
	settings = { ...DEFAULTS };
	try {
		Object.assign(settings, JSON.parse(fs.readFileSync(file(), "utf8")));
	} catch {} // missing or corrupt file → defaults; never block startup
	return settings;
}

function getSetting(key) {
	return loadSettings()[key];
}

function setSetting(key, value) {
	loadSettings()[key] = value;
	try {
		fs.writeFileSync(file(), JSON.stringify(settings, null, "\t"));
	} catch {} // read-only disk etc. — setting still applies for this run
}

module.exports = { getSetting, setSetting };
