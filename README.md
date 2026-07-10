# Murphy Desktop

Desktop app for [murphy-cloud.com](https://murphy-cloud.com) — launch the Murphy family cloud like an app instead of a browser tab. Same idea as Discord: the web UI wrapped in Electron, plus native niceties a browser tab can't do.

## What it does

- Opens murphy-cloud.com in its own window with the Murphy icon; window size/position remembered.
- **Stays logged in** across restarts (persistent session).
- **System tray**: closing the window (X) hides to tray; right-click the tray icon → Open / Quit.
- **Calls work fully**: mic, camera, and screen sharing (native OS picker), including the embedded Element Call widget.
- **Call widget** (Discord-style): while you're in a call and the app isn't focused — minimized, hidden to tray, or behind a game — a small strip appears at the top-left of the screen with everyone's avatar (real Nextcloud profile pictures) and a speaking glow. Drag it anywhere; toggle it from the tray.
- **Per-person volume**: hover someone's avatar on the widget for a volume slider (persists across calls and restarts). The same control also exists natively inside the call UI (tile ⋮ menu → Volume / Mute for me).
- **Native notifications** from Nextcloud land in your OS notification center.
- Links outside murphy-cloud.com open in your normal browser; the app never leaves the family domains.

## Develop

```sh
npm install
npm start          # run the app
npm run smoke      # headless-ish sanity check: loads the site, screenshots, prints UA/errors
```

## Download (family, start here)

Grab the latest installer from **[Releases](https://github.com/cmalagon96/murphy-desktop/releases/latest)**:

- **Windows**: `Murphy Desktop Setup x.y.z.exe`
- **Mac**: `Murphy Desktop-x.y.z.dmg` (Apple Silicon + Intel)
- **Linux**: `Murphy Desktop-x.y.z.AppImage` (`chmod +x`, then run)

## Build installers

Releases build automatically: push a tag like `v0.2.0` and `.github/workflows/release.yml` builds all three platforms on native runners and attaches them to a GitHub Release.

Local builds (Linux host):

```sh
npm run dist:linux   # → dist/*.AppImage        (builds on Linux)
npm run dist:win     # → dist/*.exe (NSIS)      (builds on Linux via wine)
npm run dist:mac     # → REQUIRES macOS — use the release workflow instead
```

### Screen-share audio (platform truth)

Sharing your screen **never sends your system audio unless you opt in**: the
tray checkbox *"Share system audio when screensharing"* is **off by default**,
so nobody hears what you're hearing. Turning it on only has an effect on
**Windows** (Chromium's audio loopback exists solely there — Discord has the
same gap without kernel-level drivers); Linux/macOS sharers always send video
without system audio. *Receiving* share audio works everywhere; each person's
tile has its own local volume/"Mute for me" controls in the call menu.

### Unsigned-build caveats (no code-signing certs purchased)

- **macOS Gatekeeper**: first launch needs right-click → Open (or `xattr -cr "Murphy Desktop.app"`).
- **Windows SmartScreen**: first run shows "Windows protected your PC" → *More info* → *Run anyway*.

## Layout

```
src/main.js               app lifecycle, single-instance lock, UA scrub
src/shell-window.js       BaseWindow + React shell + lazy section panes, close-to-tray
src/tray.js               tray icon + menu (overlay + share-audio toggles)
src/session-setup.js      persist:murphy session, permissions, screen-share handler
src/settings.js           tiny JSON settings store (userData/settings.json)
src/nav-policy.js         isAllowedURL() — the *.murphy-cloud.com allow-list, nav/window-open policy
src/voice-monitor.js      voice-state polling, call popup, call widget, per-person volume
src/call-overlay.html     the call widget (avatars + volume popover)
src/call-popup.html       incoming-call "Join" toast
shell/                    Vite/React app for the rail + home screen
build/icon.png            app icon (generated from ~/nextcloud/favicon.svg)
```

Still out of scope: a global mute hotkey and press-and-hold push-to-talk, until a native key-hook dependency is warranted.
