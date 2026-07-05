const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("murphy", {
	navigate: (section) => ipcRenderer.send("murphy:navigate", section),
	onSection: (cb) => ipcRenderer.on("murphy:section", (_e, section) => cb(section)),
});
