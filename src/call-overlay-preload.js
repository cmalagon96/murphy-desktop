const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("murphyOverlay", {
	onState: (cb) => ipcRenderer.on("calloverlay:state", (_e, s) => cb(s)),
	setVolume: (localpart, volume) => ipcRenderer.send("calloverlay:set-volume", { localpart, volume }),
	setExpanded: (expanded) => ipcRenderer.send("calloverlay:resize", { expanded }),
	setMuted: (localpart, muted) => ipcRenderer.send("calloverlay:set-muted", { localpart, muted }),
	// width/height are renderer-measured so the window can grow to fit the menu
	setMenuOpen: (open, width, height) => ipcRenderer.send("calloverlay:menu-resize", { open, width, height }),
	message: (localpart) => ipcRenderer.send("calloverlay:message", { localpart }),
	block: (localpart, block) => ipcRenderer.send("calloverlay:block", { localpart, block }),
	kick: (localpart) => ipcRenderer.send("calloverlay:kick", { localpart }),
});
