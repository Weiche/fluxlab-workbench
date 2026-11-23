const {
  app,
  BrowserWindow,
  Menu,
  protocol,
  net,
  session,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "fluxlab",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const root = path.join(__dirname, "web");
const csp =
  "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'";
app.whenReady().then(() => {
  protocol.handle("fluxlab", async (req) => {
    const url = new URL(req.url);
    const file = path.resolve(
      root,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (
      url.hostname !== "app" ||
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file)
    )
      return new Response("Not found", { status: 404 });
    const response = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", csp);
    return new Response(response.body, { status: response.status, headers });
  });
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  Menu.setApplicationMenu(null);
  if (process.platform === "win32") app.setAppUserModelId("FluxLab.Workbench");
  const win = new BrowserWindow({
    ...(process.platform === "win32"
      ? { icon: path.join(path.dirname(process.execPath), "FluxLab.ico") }
      : {}),
    width: 1460,
    height: 970,
    minWidth: 880,
    minHeight: 630,
    backgroundColor: "#f3f5f8",
    title: "FluxLab · 电机分析工作台",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("fluxlab://app/")) e.preventDefault();
  });
  win.loadURL("fluxlab://app/");
});
app.on("window-all-closed", () => app.quit());
