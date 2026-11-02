// ── Secret store ──────────────────────────────────────────────────────────────
// Secrets (TMDB / SubDL / Wyzie keys) live in the server data folder
// (secure-store.json, base64 values; the folder is created with mode 0700).
//
// Exports register()

const { app, ipcMain } = require("../runtime");
const path = require("path");
const fs = require("fs");

// ── Secret key/value store ────────────────────────────────────────────────────

let _secureStoreFile = null;
const secureStoreFile = () =>
  _secureStoreFile ||
  (_secureStoreFile = path.join(app.getPath("userData"), "secure-store.json"));

let _secureStoreCache = null;

function readSecureStore() {
  if (_secureStoreCache) return _secureStoreCache;
  try {
    _secureStoreCache = JSON.parse(fs.readFileSync(secureStoreFile(), "utf8"));
  } catch {
    _secureStoreCache = {};
  }
  return _secureStoreCache;
}

function writeSecureStore(data) {
  _secureStoreCache = data;
  fs.writeFileSync(secureStoreFile(), JSON.stringify(data), { mode: 0o600 });
}

function secureStoreGet(key) {
  const store = readSecureStore();
  const raw = store[key];
  if (!raw) return null;
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function secureStoreSet(key, value) {
  const store = readSecureStore();
  if (value === null || value === undefined || value === "") {
    delete store[key];
  } else {
    store[key] = Buffer.from(String(value), "utf8").toString("base64");
  }
  writeSecureStore(store);
}

// ── IPC registration ──────────────────────────────────────────────────────────

function register() {
  ipcMain.handle("get-app-version", () => app.getVersion());

  ipcMain.handle("secure-store-get", (_, key) => {
    try {
      return { ok: true, value: secureStoreGet(key) };
    } catch {
      return { ok: false, value: null };
    }
  });

  ipcMain.handle("secure-store-set", (_, { key, value }) => {
    try {
      secureStoreSet(key, value);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { register };
