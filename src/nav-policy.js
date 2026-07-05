const { shell } = require("electron");

// The murphy-cloud.com family: apex + element./matrix./call./rosie. subdomains.
const ALLOWED_HOST = /(^|\.)murphy-cloud\.com$/;

function parse(url) {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

function isAllowedURL(url) {
	const u = parse(url);
	return !!u && (u.protocol === "https:" || u.protocol === "http:") && ALLOWED_HOST.test(u.hostname);
}

function applyNavPolicy(wc) {
	// will-frame-navigate fires for main frame AND subframes (will-navigate is
	// main-frame-only and would double-fire openExternal alongside this).
	wc.on("will-frame-navigate", (event) => {
		const u = parse(event.url);
		if (!u) return;
		// Non-http schemes: about:blank/blob:/data: are normal widget plumbing in
		// subframes (Element Call is double-iframed) — let them through. In the
		// main frame, hand mailto: to the OS and block anything else exotic.
		if (u.protocol !== "https:" && u.protocol !== "http:") {
			if (event.isMainFrame && u.protocol !== "about:") {
				event.preventDefault();
				if (u.protocol === "mailto:") shell.openExternal(event.url);
			}
			return;
		}
		if (ALLOWED_HOST.test(u.hostname)) return;
		event.preventDefault();
		// External link clicked in the app → system browser. A subframe trying to
		// navigate outside the family is denied silently (opening a browser from
		// a hidden iframe would be surprising).
		if (event.isMainFrame) shell.openExternal(event.url);
	});

	// Never spawn a second remote window: in-family target=_blank links become
	// normal navigations in this window, everything else goes to the system.
	wc.setWindowOpenHandler(({ url }) => {
		if (isAllowedURL(url)) {
			wc.loadURL(url);
		} else if (/^(https?|mailto):/i.test(url)) {
			shell.openExternal(url);
		}
		return { action: "deny" };
	});
}

module.exports = { isAllowedURL, applyNavPolicy };
