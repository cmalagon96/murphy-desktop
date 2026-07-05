const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("murphyOverlay", {
	onState: (cb) => ipcRenderer.on("calloverlay:state", (_e, s) => cb(s)),
});
