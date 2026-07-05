# Murphy Desktop

Desktop app for [murphy-cloud.com](https://murphy-cloud.com) — launch the Murphy family cloud like an app instead of a browser tab. Same idea as Discord: the web UI wrapped in Electron, plus native niceties a browser tab can't do.

## What it does

- Opens murphy-cloud.com in its own window with the Murphy icon; window size/position remembered.
- **Stays logged in** across restarts (persistent session).
- **System tray**: closing the window (X) hides to tray; right-click the tray icon → Open / Quit.
- **Calls work fully**: mic, camera, and screen sharing (native OS picker), including the embedded Element Call widget.
- **Native notifications** from Nextcloud land in your OS notification center.
- Links outside murphy-cloud.com open in your normal browser; the app never leaves the family domains.

## Develop

```sh
npm install
npm start          # run the app
npm run smoke      # headless-ish sanity check: loads the site, screenshots, prints UA/errors
```

## Build installers

```sh
npm run dist:linux   # → dist/*.AppImage        (builds on Linux)
npm run dist:win     # → dist/*.exe (NSIS)      (builds on Linux via wine)
npm run dist:mac     # → dist/*.dmg / *.zip     (REQUIRES macOS — use the GitHub Actions workflow)
```

macOS builds can't be produced from Linux — push a tag (or run the workflow manually) and `.github/workflows/build-mac.yml` produces the dmg/zip on a `macos-latest` runner, unsigned.

### Unsigned-build caveats (no code-signing certs purchased)

- **macOS Gatekeeper**: first launch needs right-click → Open (or `xattr -cr "Murphy Desktop.app"`).
- **Windows SmartScreen**: first run shows "Windows protected your PC" → *More info* → *Run anyway*.

## Layout

```
src/main.js            app lifecycle, single-instance lock, UA scrub
src/window-manager.js  main window, bounds persistence, close-to-tray
src/tray.js            tray icon + menu
src/session-setup.js   persist:murphy session, permissions, screen-share handler
src/nav-policy.js      isAllowedURL() — the *.murphy-cloud.com allow-list, nav/window-open policy
build/icon.png         app icon (generated from ~/nextcloud/favicon.svg)
```

Planned v2 (see `~/.claude/plans/hazy-plotting-fox.md`): always-on-top voice-call overlay (polls `murphy_calls` `/voice-state`) and a global mute hotkey. Press-and-hold push-to-talk is explicitly out of scope until a native key-hook dependency is warranted.
