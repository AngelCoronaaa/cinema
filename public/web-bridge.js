// -- Streambert browser API client ------------------------------------------------
// Installs `window.api`, the interface the React app uses to talk to the
// Streambert Node server (server/index.js):
//
//   request/response calls → POST /api/invoke/:channel  ({ args: [...] })
//   server → browser events ← GET  /api/events          (Server-Sent Events)
//
// Things that only exist in the browser (pop-out window, notifications, zoom,
// cache storage) are implemented here, client-side.
//
// Loaded as a classic <script> from index.html so it runs before any app module
// (bundled modules such as storage.js read `window.api` at load time).

(function () {
  if (typeof window === "undefined" || window.api) return;

  const clientId =
    (crypto.randomUUID && crypto.randomUUID()) ||
    Math.random().toString(36).slice(2) + Date.now().toString(36);

  // -- Transport ------------------------------------------------------------------
  async function invoke(channel, ...args) {
    const res = await fetch(`/api/invoke/${encodeURIComponent(channel)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
      body: JSON.stringify({ args }),
      credentials: "same-origin",
    });
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (!res.ok) {
      const err = new Error(body?.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body?.result ?? null;
  }

  // -- Events -----------------------------------------------------------------------
  const listeners = new Map(); // channel → Set<fn(...args)>
  const on = (channel, fn) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(fn);
    return fn;
  };
  const off = (channel, fn) => listeners.get(channel)?.delete(fn);
  const emit = (channel, ...args) => {
    for (const fn of [...(listeners.get(channel) || [])]) {
      try {
        fn(...args);
      } catch (e) {
        console.error(`[api] listener for ${channel} failed`, e);
      }
    }
  };

  const es = new EventSource(`/api/events?client=${encodeURIComponent(clientId)}`);
  es.onmessage = (ev) => {
    try {
      const { channel, args } = JSON.parse(ev.data);
      emit(channel, ...(Array.isArray(args) ? args : []));
    } catch {}
  };

  // Subscribe helper returning the handle that the matching off* expects
  const sub = (channel, map = (...a) => a) => (cb) =>
    on(channel, (...a) => cb(...map(...a)));
  const unsub = (channel) => (h) => off(channel, h);

  const openTab = (url) => window.open(url, "_blank", "noopener");

  // -- Pop-out player (browser popup window) -----------------------------------------
  let pipWin = null;
  let pipTimer = null;
  function openPipWindow(url, title) {
    if (!url || url === "about:blank") return Promise.resolve({ ok: false, reason: "no-url" });
    const w = window.open(
      url,
      "streambert-popout",
      "popup=yes,width=640,height=360,menubar=no,toolbar=no,location=no,status=no",
    );
    if (!w) return Promise.resolve({ ok: false, reason: "popup-blocked" });
    try {
      if (title) w.document.title = `${title} - Pop-out`;
    } catch {}
    const wasOpen = pipWin && !pipWin.closed;
    pipWin = w;
    clearInterval(pipTimer);
    pipTimer = setInterval(() => {
      if (!pipWin || pipWin.closed) {
        clearInterval(pipTimer);
        pipWin = null;
        emit("pip-window-closed");
      }
    }, 700);
    if (!wasOpen) emit("pip-window-opened");
    return Promise.resolve({ ok: true });
  }

  // -- Notifications --------------------------------------------------------------------
  async function showNotification({ title, body, silent } = {}) {
    if (!("Notification" in window)) return;
    try {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") {
        new Notification(String(title ?? ""), { body: String(body ?? ""), silent: !!silent });
      }
    } catch {}
  }

  // -- Browser cache (Cache Storage) ------------------------------------------------------
  async function clearAppCache() {
    try {
      if (window.caches) {
        for (const k of await caches.keys()) await caches.delete(k);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // -- API ---------------------------------------------------------------------------------
  window.api = {
    // Download to this device (server remuxes the stream, browser saves it)
    prepareDownload: (args) => invoke("prepare-download", args),

    // Links
    openExternal: async (url) => {
      try {
        const u = new URL(url);
        if (u.protocol === "http:" || u.protocol === "https:") openTab(u.href);
      } catch {}
    },

    // HiAnime
    resolveHiAnime: (args) => invoke("resolve-hianime", args),
    setPlayerVideo: (args) => invoke("set-player-video", args),
    onHiAnimeProgress: (cb) => {
      const h = on("hianime-progress", (data) => cb(data?.stage));
      return () => off("hianime-progress", h);
    },

    // Pop-out player
    openPipWindow: (url, title) => openPipWindow(url, title),
    closePipWindow: async () => {
      try {
        pipWin?.close();
      } catch {}
    },
    onPipOpened: sub("pip-window-opened"),
    offPipOpened: unsub("pip-window-opened"),
    onPipClosed: sub("pip-window-closed"),
    offPipClosed: unsub("pip-window-closed"),

    // Subtitles
    searchSubtitles: (args) => invoke("search-subtitles", args),
    // Wyzie: open the redeem page in a tab, the user pastes the key manually.
    wyzieOpenRedeem: async () => {
      openTab("https://sub.wyzie.io/redeem");
      return { cancelled: true };
    },
    wyzieValidateKey: async () => ({ ok: true }),

    // Secrets (TMDB / SubDL / Wyzie keys), stored on the server
    secureGet: (key) => invoke("secure-store-get", key).then((r) => r?.value ?? null),
    secureSet: (key, value) => invoke("secure-store-set", { key, value }),

    // App
    getAppVersion: () => invoke("get-app-version"),
    showNotification,
    setZoomFactor: (factor) => {
      const f = Number(factor);
      if (Number.isFinite(f) && f > 0) document.documentElement.style.zoom = String(f);
    },
    clearAppCache,
  };
})();
