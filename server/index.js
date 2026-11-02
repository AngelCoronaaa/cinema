#!/usr/bin/env node
// -- Streambert Web Server -----------------------------------------------------
// Serves the Streambert web app and its API:
//
//   POST /api/invoke/:channel   call a server handler          ({ args: [...] })
//   GET  /api/events            Server-Sent Events: server → browser messages
//   GET  /api/export/…          Downloads to the user's device (MP4 / SRT)
//   GET  /player|/proxy|/hls.js Forwarded to the HiAnime local player server
//   GET  /*                     Static files from dist/ (vite build output)
//
// Config (env vars, or a `.env` file in the project root):
//   PORT                 default 3210
//   HOST                 default 127.0.0.1 (use 0.0.0.0 to allow LAN access)
//   STREAMBERT_TOKEN     access token; auto-generated when HOST is not loopback
//   STREAMBERT_DATA_DIR  data folder, default ~/.streambert-web
//   TMDB_TOKEN           TMDB Read Access Token for everyone (skips the setup screen)
//   WYZIE_API_KEY        Wyzie Subs key for subtitle search/download (optional)
//   SUBDL_API_KEY        SubDL key, used instead of Wyzie when set (optional)

const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const os = require("os");

const { ipcMain, events, ROOT, DATA_DIR } = require("./runtime");

const DIST_DIR = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT) || 3210;
const HOST = process.env.HOST || "127.0.0.1";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const isLoopbackBind = LOOPBACK.has(HOST);

// -- Access token ------------------------------------------------------------------
// Required whenever the server is reachable from other machines.
function loadToken() {
  if (process.env.STREAMBERT_TOKEN) return process.env.STREAMBERT_TOKEN;
  if (isLoopbackBind) return null;
  const file = path.join(DATA_DIR, "web-token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (t) return t;
  } catch {}
  const t = crypto.randomBytes(18).toString("base64url");
  fs.writeFileSync(file, t, { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();
const COOKIE = "sb_token";

// -- Event channel (SSE) ------------------------------------------------------------
const clients = new Map(); // clientId → res

function writeEvent(res, channel, args) {
  try {
    res.write(`data: ${JSON.stringify({ channel, args })}\n\n`);
  } catch {}
}
function broadcast(channel, args) {
  for (const res of clients.values()) writeEvent(res, channel, args);
}
function sendTo(clientId, channel, args) {
  const res = clients.get(clientId);
  if (res) writeEvent(res, channel, args);
  else broadcast(channel, args);
}

events.setBroadcaster(broadcast);

// -- Register the API modules -------------------------------------------------------
const storageIpc = require("./ipc/storage");
const subtitlesIpc = require("./ipc/subtitles");
const hianimeIpc = require("./ipc/hianime");
const exportIpc = require("./ipc/export");

storageIpc.register();
subtitlesIpc.register();
hianimeIpc.register();
exportIpc.register();

// HiAnime: the local player server only listens on 127.0.0.1 and checks the
// Host header. Browsers on other machines can't reach it, so its routes are
// forwarded through this server and the returned URL is made relative.
let hianimePort = null;
{
  const original = ipcMain.getHandler("set-player-video");
  ipcMain.handle("set-player-video", async (event, args = {}) => {
    const result = await original(event, args);
    // Downloads must send the Referer the stream host expects
    if (typeof args.url === "string") {
      exportIpc.rememberStreamMeta(args.url, { referer: args.referer || "" });
    }
    const m = /^http:\/\/127\.0\.0\.1:(\d+)(\/.*)$/.exec(result?.playerUrl || "");
    if (m) {
      hianimePort = Number(m[1]);
      return { ...result, playerUrl: m[2] };
    }
    return result;
  });
}

// Server-wide keys from the environment (.env). Several people share this
// server, so these are the administrator's: when set they always win, and the
// browser can't overwrite them.
const ENV_SECRETS = {
  apikey: (process.env.TMDB_TOKEN || "").trim(),
  wyzieApiKey: (process.env.WYZIE_API_KEY || "").trim(),
  subdlApiKey: (process.env.SUBDL_API_KEY || "").trim(),
};
{
  const originalGet = ipcMain.getHandler("secure-store-get");
  ipcMain.handle("secure-store-get", async (event, key) => {
    if (ENV_SECRETS[key]) return { ok: true, value: ENV_SECRETS[key] };
    return originalGet(event, key);
  });
  const originalSet = ipcMain.getHandler("secure-store-set");
  ipcMain.handle("secure-store-set", async (event, args = {}) => {
    if (ENV_SECRETS[args.key]) {
      return { ok: false, error: "This key is set by the server administrator (.env)." };
    }
    return originalSet(event, args);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

// -- Request helpers --------------------------------------------------------------------
function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readJson(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  const data = JSON.stringify(body === undefined ? null : body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function hostAllowed(req) {
  if (!isLoopbackBind) return true; // remote mode: protected by the token
  const host = (req.headers.host || "").toLowerCase();
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return LOOPBACK.has(name);
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// -- HiAnime forwarding --------------------------------------------------------------------
function forwardToHiAnime(req, res) {
  if (!hianimePort) {
    res.writeHead(404);
    res.end();
    return;
  }
  const headers = { ...req.headers, host: `127.0.0.1:${hianimePort}` };
  delete headers.cookie;
  const upstream = http.request(
    { host: "127.0.0.1", port: hianimePort, path: req.url, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.on("close", () => upstream.destroy());
  upstream.end();
}

// -- Static files ----------------------------------------------------------------------------
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(DIST_DIR, rel));
  if (!file.startsWith(DIST_DIR + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  let target = file;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    // SPA fallback (no client-side router today, but keeps deep links safe)
    if (path.extname(rel)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    target = path.join(DIST_DIR, "index.html");
  }
  const ext = path.extname(target).toLowerCase();
  const isHtml = ext === ".html";
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": isHtml || rel === "/" ? "no-cache" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(target).pipe(res);
}


// -- Router --------------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const { pathname } = url;

  if (!hostAllowed(req)) {
    res.writeHead(403);
    res.end("Forbidden host");
    return;
  }

  // Token auth (remote mode)
  if (TOKEN) {
    const given = url.searchParams.get("token");
    if (given && safeEqual(given, TOKEN)) {
      url.searchParams.delete("token");
      res.writeHead(302, {
        "Set-Cookie": `${COOKIE}=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
        Location: url.pathname + (url.search || ""),
      });
      res.end();
      return;
    }
    if (!safeEqual(parseCookies(req.headers.cookie)[COOKIE], TOKEN)) {
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Streambert</title>` +
          `<body style="background:#0a0a0a;color:#ddd;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0">` +
          `<form style="display:grid;gap:10px;width:min(320px,90vw)"><b>Streambert</b>` +
          `<input name="token" placeholder="Access token" autofocus style="padding:10px;border-radius:6px;border:1px solid #333;background:#151515;color:#eee">` +
          `<button style="padding:10px;border-radius:6px;border:0;background:#e50914;color:#fff">Open</button></form>`,
      );
      return;
    }
  }

  // HiAnime player routes (token-protected by the player server itself)
  if (
    (pathname === "/player" || pathname === "/proxy" || pathname === "/hls.js") &&
    url.searchParams.has("t")
  ) {
    forwardToHiAnime(req, res);
    return;
  }

  if (pathname.startsWith("/api/")) {
    if (!originAllowed(req)) return json(res, 403, { error: "Bad origin" });

    // main → renderer event stream
    if (pathname === "/api/events" && req.method === "GET") {
      const clientId = String(url.searchParams.get("client") || crypto.randomUUID()).slice(0, 64);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 2000\n\n");
      clients.set(clientId, res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => {
        clearInterval(ping);
        if (clients.get(clientId) === res) clients.delete(clientId);
      });
      return;
    }

    const invoke = /^\/api\/invoke\/([\w:-]+)$/.exec(pathname);
    if (invoke && req.method === "POST") {
      if (!/^application\/json/i.test(req.headers["content-type"] || "")) {
        return json(res, 415, { error: "Expected application/json" });
      }
      const channel = invoke[1];
      const fn = ipcMain.getHandler(channel);
      if (!fn) return json(res, 404, { error: `No handler registered for '${channel}'` });
      const clientId = String(req.headers["x-client-id"] || "");
      // Lets a handler report progress to the tab that made the call
      const event = {
        sender: {
          isDestroyed: () => false,
          send: (ch, ...args) => sendTo(clientId, ch, args),
        },
      };
      try {
        const body = await readJson(req);
        const args = Array.isArray(body.args) ? body.args : [];
        const result = await fn(event, ...args);
        return json(res, 200, { result: result === undefined ? null : result });
      } catch (e) {
        return json(res, 500, { error: String(e?.message || e) });
      }
    }

    // Downloads to the user's device (video → MP4, subtitles → SRT)
    if (pathname.startsWith("/api/export/") && req.method === "GET") {
      return exportIpc.handleExportRequest(req, res, url);
    }

    return json(res, 404, { error: "Not found" });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  serveStatic(req, res, pathname);
}

// -- Start -----------------------------------------------------------------------------------
if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
  console.error("dist/index.html not found. Run `npm run build` (or `npm run web`) first.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error("[web]", e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

server.listen(PORT, HOST, () => {
  const shown = isLoopbackBind ? "localhost" : HOST === "0.0.0.0" || HOST === "::" ? lanAddress() : HOST;
  const base = `http://${shown.includes(":") ? `[${shown}]` : shown}:${PORT}/`;
  console.log(`\n  Streambert web is running → ${base}${TOKEN ? `?token=${TOKEN}` : ""}`);
  console.log(`  Data folder: ${DATA_DIR}`);
  if (TOKEN) console.log("  Access token required (shown in the URL above).");
  console.log("");
});

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "localhost";
}

function shutdown() {
  for (const res of clients.values()) {
    try {
      res.end();
    } catch {}
  }
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
