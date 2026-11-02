// -- Streambert server runtime ---------------------------------------------------
// Shared services for the server-side modules in server/ipc/:
//
//   paths      data folder, project root, user folders
//   ipcMain    channel registry: handle(channel, fn) for request/response calls
//              (POST /api/invoke/:channel) and on(channel, fn) for one-way calls
//   events     sendToClients(channel, ...args) pushes to every open browser tab
//              (Server-Sent Events, wired up in server/index.js)
//   shell      open a file or folder on the machine that runs the server

const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));

// Load .env before anything reads process.env (real env vars take precedence)
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {}

const DATA_DIR = path.resolve(
  process.env.STREAMBERT_DATA_DIR || path.join(os.homedir(), ".streambert-web"),
);
fs.mkdirSync(DATA_DIR, { recursive: true });
try {
  fs.chmodSync(DATA_DIR, 0o700);
} catch {}

// -- Paths / app info ----------------------------------------------------------------
const app = {
  version: pkg.version,
  getVersion: () => pkg.version,
  getAppPath: () => ROOT,
  getPath(name) {
    switch (name) {
      case "userData":
        return DATA_DIR;
      case "temp":
        return os.tmpdir();
      case "home":
        return os.homedir();
      case "downloads":
        return path.join(os.homedir(), "Downloads");
      default:
        return DATA_DIR;
    }
  },
};

// -- Channel registry ------------------------------------------------------------------
const handlers = new Map();
const listeners = new EventEmitter();
listeners.setMaxListeners(100);

const ipcMain = {
  handle(channel, fn) {
    handlers.set(channel, fn);
  },
  on(channel, fn) {
    listeners.on(channel, fn);
    return ipcMain;
  },
  getHandler: (channel) => handlers.get(channel),
  emit: (channel, ...args) => listeners.emit(channel, ...args),
};

// -- Server → browser events ------------------------------------------------------------
let _broadcast = () => {};
const events = {
  setBroadcaster(fn) {
    _broadcast = fn;
  },
  sendToClients(channel, ...args) {
    _broadcast(channel, args);
  },
};

// -- Open things on the server machine ----------------------------------------------------
function openWithSystem(target, { reveal = false } = {}) {
  let cmd;
  let args;
  if (process.platform === "darwin") {
    cmd = "open";
    args = reveal ? ["-R", target] : [target];
  } else if (process.platform === "win32") {
    cmd = "explorer.exe";
    args = reveal ? [`/select,${target}`] : [target];
  } else {
    cmd = "xdg-open";
    args = [reveal ? path.dirname(target) : target];
  }
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
      child.on("error", (e) => resolve(e.message));
      child.on("spawn", () => {
        child.unref();
        resolve("");
      });
    } catch (e) {
      resolve(e.message);
    }
  });
}

const shell = {
  openPath: (p) => openWithSystem(p),
  showItemInFolder: (p) => openWithSystem(p, { reveal: true }),
};

module.exports = { app, ipcMain, events, shell, ROOT, DATA_DIR };
