// ── Download to the user's device ───────────────────────────────────────────────
// Streams a video (HLS) or a subtitle straight to the browser as a file
// download, so it is saved on the device of whoever clicked "Download". Nothing
// is stored on the server.
//
//   prepare-download (API)            → registers a job, returns download links
//   GET /api/export/:id/video         → HLS → MP4, streamed while it downloads
//   GET /api/export/:id/sub/:index    → subtitle as .srt
//   GET /api/export/subtitle?fileId=… → subtitle from the SubDL/Wyzie search
//
// HLS handling: picks the best variant, decrypts AES-128 segments, and remuxes
// MPEG-TS to fragmented MP4 with mux.js (pure JavaScript, no ffmpeg needed).
// fMP4 streams (EXT-X-MAP) are copied as-is. If a stream can't be remuxed the
// original .ts is sent instead (plays in VLC and most TVs).
//
// Every URL fetched (playlists, keys, segments, subtitles) must resolve to a
// public address (SSRF guard shared with the HiAnime module).

const crypto = require("crypto");
const muxjs = require("mux.js");
const { ipcMain } = require("../runtime");
const { assertPublicUrl } = require("./hianime");
const { fetchWithTimeout, extractFirstSubtitleFromZip } = require("./subtitles");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const JOB_TTL = 6 * 60 * 60 * 1000;
const MAX_JOBS = 200;
const CONCURRENCY = 4;
const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;

// ── Stream headers remembered per URL (filled when the player starts) ───────
const streamMeta = new Map(); // url → { referer }
function rememberStreamMeta(url, meta = {}) {
  if (typeof url !== "string" || !url) return;
  if (streamMeta.size > 100) streamMeta.delete(streamMeta.keys().next().value);
  const referer = /^https?:\/\//i.test(meta.referer || "") ? String(meta.referer).slice(0, 2048) : "";
  streamMeta.set(url, { referer });
}

// ── Jobs ──────────────────────────────────────────────────────────────────────
const jobs = new Map(); // id → { url, referer, title, subtitles: [{url, lang}], created }

function pruneJobs() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.created > JOB_TTL) jobs.delete(id);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
}

function safeFileName(title, ext) {
  const base = String(title || "Streambert")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "Streambert";
  return `${base}.${ext}`;
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
const checkedHosts = new Map(); // host → expiry
async function guard(url) {
  const host = new URL(url).host;
  const exp = checkedHosts.get(host);
  if (exp && exp > Date.now()) return;
  await assertPublicUrl(url);
  checkedHosts.set(host, Date.now() + 10 * 60 * 1000);
}

async function get(url, referer, { signal, timeout = 30000 } = {}) {
  await guard(url);
  const headers = { "User-Agent": USER_AGENT, Accept: "*/*" };
  if (referer) {
    headers.Referer = referer;
    try {
      headers.Origin = new URL(referer).origin;
    } catch {}
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: ctrl.signal });
    if (res.url && res.url !== url) await guard(res.url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
    return res;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function getText(url, referer, opts) {
  const res = await get(url, referer, opts);
  const text = await res.text();
  if (text.length > MAX_PLAYLIST_BYTES) throw new Error("Playlist too large");
  return text;
}

async function getBuffer(url, referer, opts) {
  const res = await get(url, referer, opts);
  return Buffer.from(await res.arrayBuffer());
}

// ── HLS parsing ───────────────────────────────────────────────────────────────
function attrs(line) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(line))) out[m[1]] = m[2].replace(/^"|"$/g, "");
  return out;
}

async function resolveMediaPlaylist(url, referer, signal) {
  let text = await getText(url, referer, { signal });
  if (!text.startsWith("#EXTM3U")) throw new Error("Not an HLS playlist");
  if (text.includes("#EXT-X-STREAM-INF")) {
    // Master playlist: take the highest-bandwidth variant
    const lines = text.split(/\r?\n/);
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
      const a = attrs(lines[i]);
      const uri = lines.slice(i + 1).find((l) => l && !l.startsWith("#"));
      if (!uri) continue;
      const bw = Number(a.BANDWIDTH) || 0;
      if (!best || bw > best.bw) best = { bw, uri, res: a.RESOLUTION };
    }
    if (!best) throw new Error("No playable variant");
    url = new URL(best.uri, url).href;
    text = await getText(url, referer, { signal });
  }
  return { url, text };
}

function parseMediaPlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  let seq = 0;
  let key = null; // { method, uri, iv }
  let map = null;
  let mediaSeq = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSeq = Number(line.split(":")[1]) || 0;
      seq = mediaSeq;
    } else if (line.startsWith("#EXT-X-KEY:")) {
      const a = attrs(line.slice(11));
      key = a.METHOD && a.METHOD !== "NONE"
        ? { method: a.METHOD, uri: a.URI ? new URL(a.URI, baseUrl).href : null, iv: a.IV || null }
        : null;
    } else if (line.startsWith("#EXT-X-MAP:")) {
      const a = attrs(line.slice(11));
      if (a.URI) map = new URL(a.URI, baseUrl).href;
    } else if (!line.startsWith("#")) {
      segments.push({ url: new URL(line, baseUrl).href, key, seq });
      seq += 1;
    }
  }
  if (segments.some((s) => s.key && s.key.method !== "AES-128")) {
    throw new Error("This stream uses DRM encryption and can't be downloaded");
  }
  return { segments, map };
}

// ── Segment pipeline (ordered, with prefetch) ────────────────────────────────
function ivFor(seg) {
  if (seg.key.iv) {
    const hex = seg.key.iv.replace(/^0x/i, "").padStart(32, "0");
    return Buffer.from(hex, "hex");
  }
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(seg.seq >>> 0, 12);
  return iv;
}

async function* fetchSegments(segments, referer, signal) {
  const keys = new Map(); // uri → Promise<Buffer>
  const load = async (seg) => {
    let data = await getBuffer(seg.url, referer, { signal, timeout: 60000 });
    if (seg.key) {
      if (!keys.has(seg.key.uri)) keys.set(seg.key.uri, getBuffer(seg.key.uri, referer, { signal }));
      const key = await keys.get(seg.key.uri);
      const decipher = crypto.createDecipheriv("aes-128-cbc", key, ivFor(seg));
      data = Buffer.concat([decipher.update(data), decipher.final()]);
    }
    return data;
  };
  const queue = [];
  let next = 0;
  const fill = () => {
    while (queue.length < CONCURRENCY && next < segments.length) {
      const p = load(segments[next++]);
      p.catch(() => {}); // handled when awaited
      queue.push(p);
    }
  };
  fill();
  while (queue.length) {
    const data = await queue.shift();
    fill();
    yield data;
  }
}

function write(res, chunk) {
  if (res.destroyed) return Promise.reject(new Error("client closed"));
  if (res.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      res.off("close", onClose);
      resolve();
    };
    const onClose = () => {
      res.off("drain", onDrain);
      reject(new Error("client closed"));
    };
    res.once("drain", onDrain);
    res.once("close", onClose);
  });
}

// ── Video export ──────────────────────────────────────────────────────────────
async function streamVideo(job, req, res) {
  const ctrl = new AbortController();
  req.on("close", () => ctrl.abort());
  const { signal } = ctrl;

  const media = await resolveMediaPlaylist(job.url, job.referer, signal);
  const { segments, map } = parseMediaPlaylist(media.text, media.url);
  if (!segments.length) throw new Error("Empty playlist");

  const iter = fetchSegments(segments, job.referer, signal);
  const first = await iter.next();
  if (first.done) throw new Error("No segments");

  const sendHeaders = (ext, type) => {
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Disposition": contentDisposition(safeFileName(job.title, ext)),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
  };

  // fMP4 HLS: init segment + fragments are already an MP4 file
  if (map) {
    const init = await getBuffer(map, job.referer, { signal });
    sendHeaders("mp4", "video/mp4");
    await write(res, init);
    await write(res, first.value);
    for await (const seg of iter) await write(res, seg);
    res.end();
    return;
  }

  // MPEG-TS → fragmented MP4
  const transmuxer = new muxjs.mp4.Transmuxer({ remux: true });
  let pending = [];
  let initSent = false;
  transmuxer.on("data", (s) => {
    if (!initSent) {
      pending.push(Buffer.from(s.initSegment));
      initSent = true;
    }
    pending.push(Buffer.from(s.data));
  });
  const remux = (buf) => {
    transmuxer.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    transmuxer.flush();
    const out = pending;
    pending = [];
    return out;
  };

  const firstOut = remux(first.value);
  if (!firstOut.length) {
    // Couldn't remux (unusual codec): send the original transport stream
    sendHeaders("ts", "video/mp2t");
    await write(res, first.value);
    for await (const seg of iter) await write(res, seg);
    res.end();
    return;
  }

  sendHeaders("mp4", "video/mp4");
  for (const c of firstOut) await write(res, c);
  for await (const seg of iter) {
    for (const c of remux(seg)) await write(res, c);
  }
  res.end();
}

// ── Subtitles ─────────────────────────────────────────────────────────────────
function vttToSrt(text) {
  const blocks = text
    .replace(/^﻿/, "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .filter((b) => b.includes("-->"));
  return (
    blocks
      .map((b, i) => {
        const lines = b.split("\n");
        const t = lines.findIndex((l) => l.includes("-->"));
        const time = lines[t]
          .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, "$1,$2")
          .replace(/(^|\s)(\d{2}:\d{2})\.(\d{3})/g, "$100:$2,$3")
          .replace(/\s+(align|line|position|size|vertical|region):\S+/g, "");
        const body = lines
          .slice(t + 1)
          .join("\n")
          .replace(/<\/?(c|v|ruby|rt|lang)[^>]*>/g, "");
        return `${i + 1}\n${time}\n${body}`;
      })
      .join("\n\n") + "\n"
  );
}

function sendSubtitle(res, title, lang, data) {
  let text = data.toString("utf8");
  if (/^﻿?WEBVTT/.test(text)) text = vttToSrt(text);
  const name = safeFileName(lang ? `${title}.${lang}` : title, "srt");
  res.writeHead(200, {
    "Content-Type": "application/x-subrip; charset=utf-8",
    "Content-Disposition": contentDisposition(name),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

async function exportSubtitleFromSearch(fileId, title, lang, res) {
  const id = String(fileId || "");
  if (id.startsWith("subdl_")) {
    const subdlPath = decodeURIComponent(id.split("_").slice(2).join("_"));
    if (!subdlPath.startsWith("/")) throw new Error("Invalid subtitle id");
    const r = await fetchWithTimeout(`https://dl.subdl.com${subdlPath}`, { headers: { "User-Agent": "Streambert" } }, 30000);
    if (!r.ok) throw new Error(`SubDL error ${r.status}`);
    const extracted = extractFirstSubtitleFromZip(Buffer.from(await r.arrayBuffer()));
    if (!extracted) throw new Error("No subtitle file in the SubDL archive");
    return sendSubtitle(res, title, lang, extracted.data);
  }
  if (id.startsWith("wyzie_")) {
    const url = decodeURIComponent(id.split("_").slice(2).join("_"));
    const data = await getBuffer(url, "", {});
    return sendSubtitle(res, title, lang, data);
  }
  throw new Error("Unknown subtitle source");
}

// ── HTTP entry point (called from server/index.js) ─────────────────────────────
async function handleExportRequest(req, res, url) {
  const fail = (status, message) => {
    if (!res.headersSent) {
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(message);
    } else {
      res.destroy();
    }
  };
  try {
    if (url.pathname === "/api/export/subtitle") {
      const title = url.searchParams.get("title") || "Subtitle";
      const lang = (url.searchParams.get("lang") || "").replace(/[^a-z-]/gi, "").slice(0, 8);
      return await exportSubtitleFromSearch(url.searchParams.get("fileId"), title, lang, res);
    }
    const m = /^\/api\/export\/([a-f0-9]{32})\/(video|sub)(?:\/(\d+))?$/.exec(url.pathname);
    if (!m) return fail(404, "Not found");
    pruneJobs();
    const job = jobs.get(m[1]);
    if (!job) return fail(410, "This download link has expired. Start the download again from Streambert.");
    if (m[2] === "video") return await streamVideo(job, req, res);
    const sub = job.subtitles[Number(m[3])];
    if (!sub) return fail(404, "Subtitle not found");
    const data = await getBuffer(sub.url, job.referer, {});
    return sendSubtitle(res, job.title, sub.lang, data);
  } catch (e) {
    if (e?.name === "AbortError" || e?.message === "client closed") return res.destroy();
    console.error("[export]", e?.message || e);
    return fail(502, `Download failed: ${e?.message || e}`);
  }
}

// ── API ───────────────────────────────────────────────────────────────────────
function register() {
  ipcMain.handle("prepare-download", async (_, args = {}) => {
    const url = typeof args.url === "string" ? args.url : "";
    try {
      await assertPublicUrl(url);
    } catch {
      return { ok: false, error: "This stream can't be downloaded." };
    }
    pruneJobs();
    const id = crypto.randomBytes(16).toString("hex");
    const subtitles = (Array.isArray(args.subtitles) ? args.subtitles : [])
      .filter((s) => typeof s?.url === "string" && /^https?:\/\//i.test(s.url))
      .slice(0, 10)
      .map((s) => ({ url: s.url, lang: String(s.lang || "").replace(/[^a-z-]/gi, "").slice(0, 8) }));
    const title = String(args.title || "Streambert").slice(0, 200);
    jobs.set(id, {
      url,
      referer: streamMeta.get(url)?.referer || "",
      title,
      subtitles,
      created: Date.now(),
    });
    return {
      ok: true,
      video: `/api/export/${id}/video`,
      subtitles: subtitles.map((s, i) => ({ lang: s.lang, url: `/api/export/${id}/sub/${i}` })),
      fileName: safeFileName(title, "mp4"),
    };
  });
}

module.exports = { register, handleExportRequest, rememberStreamMeta, _internal: { vttToSrt, parseMediaPlaylist } };
