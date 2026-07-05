const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("murphyPopup", {
	onState: (cb) => ipcRenderer.on("callpopup:state", (_e, s) => cb(s)),
	join: () => ipcRenderer.send("callpopup:join"),
	dismiss: () => ipcRenderer.send("callpopup:dismiss"),
});
