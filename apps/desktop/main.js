import { app, BrowserWindow, Menu, protocol, net, ipcMain, dialog } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { openIde, executable } = require("../../scripts/ide-runtime.cjs");

const { createServices } = require("../../scripts/local-services.cjs");
app.setName("Zentra");
// Preserve chats from the original Electron app profile.
app.setPath("userData", path.join(app.getPath("appData"), "desktop"));
const services = createServices(status => mainWindow?.webContents.send("runtime:status", status));
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on("second-instance", () => { mainWindow?.show(); mainWindow?.focus(); });
app.on("before-quit", () => services.stop());

const dirname = path.dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "localagent",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
// Add runtime error logging to help diagnose startup exits.
process.on("uncaughtException", (err) => {
  try {
    fs.appendFileSync("/tmp/electron-main.log", `uncaughtException: ${String(err)}\n${err.stack || ""}\n`);
  } catch {}
  console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  try {
    fs.appendFileSync("/tmp/electron-main.log", `unhandledRejection: ${String(reason)}\n`);
  } catch {}
  console.error("unhandledRejection:", reason);
});
let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#171717",
    title: "Zentra — Local AI",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(dirname, "preload.cjs"),
    },
  });
  try {
    fs.appendFileSync("/tmp/electron-main.log", `createWindow called\n`);
  } catch {}
  // Do not open devtools by default in production desktop app
  // mainWindow.webContents.openDevTools({ mode: "right" });
  mainWindow.webContents.on("did-finish-load", () => {
    try {
      const fs = require("fs");
      fs.appendFileSync("/tmp/electron-main.log", `did-finish-load: ${new Date().toISOString()}\n`);
    } catch {}
  });
  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    try {
      const fs = require("fs");
      fs.appendFileSync(
        "/tmp/electron-main.log",
        `did-fail-load: code=${errorCode} desc=${errorDescription} url=${validatedURL}\n`,
      );
    } catch {}
    console.error("did-fail-load", errorCode, errorDescription, validatedURL);
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("localagent://app/")) event.preventDefault();
  });
  mainWindow.loadURL("localagent://app/index.html");
}
app.whenReady().then(() => {
  if (!singleInstance) return;
  try {
    fs.appendFileSync("/tmp/electron-main.log", `app.whenReady\n`);
  } catch {}
  protocol.handle("localagent", async (request) => {
    const url = new URL(request.url);
    const root = path.join(dirname, "dist");
    const file = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (url.hostname !== "app" || !file.startsWith(root + path.sep))
      return new Response("Forbidden", { status: 403 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src http://127.0.0.1:* http://localhost:*; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; frame-src 'none'",
    );
    return new Response(response.body, { status: response.status, headers });
  });
  const trustedSender = (event) => event.senderFrame === mainWindow?.webContents.mainFrame && event.senderFrame.url.startsWith("localagent://app/");
  ipcMain.handle("runtime:status", event => {if (!trustedSender(event)) throw new Error("Untrusted sender"); return services.status();});
  ipcMain.handle("runtime:retry", event => {if (!trustedSender(event)) throw new Error("Untrusted sender"); return services.start();});
  ipcMain.handle("workspace:choose", async event => {
    if (!trustedSender(event)) throw new Error("Untrusted sender");
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose a workspace for Zentra",
      buttonLabel: "Use this workspace",
    });
    if (result.canceled || !result.filePaths.length) return {cancelled: true};
    return services.changeWorkspace(result.filePaths[0]);
  });
  ipcMain.handle("ide:status", (event) => {
    if (event.senderFrame !== mainWindow?.webContents.mainFrame) throw new Error("Untrusted sender");
    return { installed: Boolean(executable()) };
  });
  async function chooseProject() {
    const result = await dialog.showOpenDialog(mainWindow, {properties: ["openDirectory", "createDirectory"], title: "Choose a project for Zentra IDE", buttonLabel: "Open project"});
    if (result.canceled || !result.filePaths.length) return {opened: false};
    return openIde(result.filePaths[0]);
  }
  ipcMain.handle("ide:open", async (event, chooseFolder) => {
    if (event.senderFrame !== mainWindow?.webContents.mainFrame || !event.senderFrame.url.startsWith("localagent://app/")) throw new Error("Untrusted sender");
    return chooseFolder === true ? chooseProject() : openIde();
  });
  const navigate = (page) => mainWindow?.webContents.send("navigate", page);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "New chat",
            accelerator: "CmdOrCtrl+N",
            click: () => navigate("new"),
          },
          {
            label: "Open Agent IDE",
            accelerator: "CmdOrCtrl+Shift+I",
            click: () => openIde().catch(error => dialog.showErrorBox("Zentra IDE", error.message)),
          },
          {
            label: "Change IDE Workspace…",
            accelerator: "CmdOrCtrl+Alt+O",
            click: () => chooseProject().catch(error => dialog.showErrorBox("Zentra IDE", error.message)),
          },
          { type: "separator" },
          { role: "close" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      {
        label: "Help",
        submenu: [
          {
            label: "Quick Start",
            accelerator: "CmdOrCtrl+Shift+H",
            click: () => navigate("quickstart"),
          },
        ],
      },
    ]),
  );
  createWindow();
  void services.start();
  try {
    fs.appendFileSync("/tmp/electron-main.log", `createWindow finished\n`);
  } catch {}
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
