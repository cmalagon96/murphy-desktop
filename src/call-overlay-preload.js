const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("murphyOverlay", {
	onState: (cb) => ipcRenderer.on("calloverlay:state", (_e, s) => cb(s)),
	setVolume: (localpart, volume) => ipcRenderer.send("calloverlay:set-volume", { localpart, volume }),
	setExpanded: (expanded) => ipcRenderer.send("calloverlay:resize", { expanded }),
});
