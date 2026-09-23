const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  runtimeStatus: () => ipcRenderer.invoke("runtime:status"),
  retryServices: () => ipcRenderer.invoke("runtime:retry"),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  onRuntimeStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("runtime:status", listener);
    return () => ipcRenderer.removeListener("runtime:status", listener);
  },
  ideStatus: () => ipcRenderer.invoke("ide:status"),
  openIde: (chooseFolder = false) => ipcRenderer.invoke("ide:open", chooseFolder === true),
  onNavigate: (callback) => {
    const listener = (_event, page) => callback(page);
    ipcRenderer.on("navigate", listener);
    return () => ipcRenderer.removeListener("navigate", listener);
  },
});
