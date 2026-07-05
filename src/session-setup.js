const { desktopCapturer } = require("electron");
const { isAllowedURL } = require("./nav-policy");

// Deny-by-default: only what this stack actually uses. media = mic/cam,
// display-capture = screen share, fullscreen = call fullscreen button,
// clipboard-sanitized-write = Nextcloud "copy link" buttons.
const ALLOWED_PERMISSIONS = new Set([
	"media",
	"notifications",
	"display-capture",
	"fullscreen",
	"clipboard-sanitized-write",
]);

// Strip the "murphy-desktop/x.y.z" and "Electron/x.y.z" tokens so the UA reads
// as plain desktop Chrome (avoids Nextcloud UA-sniffing banners; Cloudflare
// already sees real Chromium underneath).
function scrubUA(ua) {
	return ua
		.split(" ")
		.filter((t) => !t.startsWith("Electron/") && !t.toLowerCase().startsWith("murphy"))
		.join(" ");
}

function allowed(permission, origin) {
	return ALLOWED_PERMISSIONS.has(permission) && isAllowedURL(origin);
}

function setupSession(ses) {
	ses.setUserAgent(scrubUA(ses.getUserAgent()));

	// Both handlers are required — recent Electron consults them independently
	// and silently denies if only one is wired.
	ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
		callback(allowed(permission, details.requestingUrl));
	});
	ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
		return allowed(permission, requestingOrigin);
	});

	// getDisplayMedia does not work in Electron without this. useSystemPicker
	// delegates to the desktop portal (KDE/PipeWire on Wayland); the callback
	// body is only the fallback path for platforms without a system picker.
	// Screen-share audio: Chromium only supports system-audio loopback on
	// Windows — omitting it there made every share silent. Linux/macOS have
	// no loopback (same platform gap Discord has).
	ses.setDisplayMediaRequestHandler(
		(request, callback) => {
			desktopCapturer
				.getSources({ types: ["screen"] })
				.then((sources) => {
					const streams = { video: sources[0] };
					if (request.audioRequested && process.platform === "win32") streams.audio = "loopback";
					callback(streams);
				})
				.catch(() => callback({}));
		},
		{ useSystemPicker: true }
	);
}

module.exports = { setupSession, scrubUA };
