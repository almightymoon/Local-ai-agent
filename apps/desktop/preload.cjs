const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  ideStatus: () => ipcRenderer.invoke("ide:status"),
  openIde: (chooseFolder = false) => ipcRenderer.invoke("ide:open", chooseFolder === true),
  onNavigate: (callback) => {
    const listener = (_event, page) => callback(page);
    ipcRenderer.on("navigate", listener);
    return () => ipcRenderer.removeListener("navigate", listener);
  },
});
