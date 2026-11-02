// localStorage-based persistence (works in both Vite dev and prod)

const PREFIX = "streambert_";
const REMOVED_SOURCES = new Set(["aether", "devideosrc", "frembed", "kinohub"]);

export const storage = {
  get(key) {
    try {
      let raw = localStorage.getItem(PREFIX + key);
      // Legacy AllManga → HiAnime migration (settings saved by older versions)
      if (!raw && key === "hianimeDubMode") {
        raw = localStorage.getItem(PREFIX + "allmangaDubMode");
      }
      const value = raw ? JSON.parse(raw) : null;
      if (key === "playerSource" && value === "allmanga") return "hianime";
      // Sources removed (no Spanish/English audio) → fall back to the default
      if (key === "playerSource" && REMOVED_SOURCES.has(value)) return null;
      // Metadata language: Latin American Spanish or English only
      if (key === "tmdbLang" && value && value !== "es-MX" && value !== "en-US")
        return String(value).startsWith("es") ? "es-MX" : "en-US";
      // Only Spanish/English subtitles are supported
      if (key === "subtitleLang" && value && value !== "es" && value !== "en")
        return "es";
      return value;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
  },
  // Remove all streambert_ keys (used by reset)
  clearAll() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
  },
};

// Centralised storage key registry
export const STORAGE_KEYS = {
  API_KEY: "apikey",
  UPDATE_SOURCE: "updateSource",
  PLAYER_SOURCE: "playerSource",
  HIANIME_DUB_MODE: "hianimeDubMode",
  WATCH_PROGRESS: "progress",
  WATCHED: "watched",
  HISTORY: "history",
  SAVED: "saved",
  SAVED_ORDER: "savedOrder",
  LOCAL_FILES: "localFiles",
  DOWNLOAD_PATH: "downloadPath",
  DOWNLOADER_FOLDER: "downloaderFolder",
  START_PAGE: "startPage",
  AGE_LIMIT: "ageLimit",
  RATING_COUNTRY: "ratingCountry",
  WATCHED_THRESHOLD: "watchedThreshold",
  HOME_ROW_ORDER: "homeRowOrder",
  HOME_ROW_VISIBLE: "homeRowVisible",
  HOME_VIEW_MODE: "homeViewMode",
  AUTO_CHECK_UPDATES: "autoCheckUpdates",
  INVIDIOUS_BASE: "invidiousBase",
  // Subtitle settings
  SUBTITLE_ENABLED: "subtitleDownload",
  SUBTITLE_LANG: "subtitleLang",
  PLAYER_AUDIO_LANG: "playerAudioLang", // "es" | "en"
  PLAYER_SUB_LANG: "playerSubLang", // "off" | "es" | "en"
  // NOTE: SUBDL_API_KEY, WYZIE_API_KEY and API_KEY are stored encrypted via secureStorage
  SUBDL_API_KEY: "subdlApiKey",
  WYZIE_API_KEY: "wyzieApiKey",
  // Appearance & behaviour
  ACCENT_COLOR: "accentColor",
  THEME: "theme",
  CUSTOM_THEME_VARS: "customThemeVars",
  FONT_SIZE: "fontSize",
  COMPACT_MODE: "compactMode",
  REDUCE_ANIMATIONS: "reduceAnimations",
  LIBRARY_SORT: "librarySort",
  HISTORY_ENABLED: "historyEnabled",
  // Notification preferences
  NOTIFY_DOWNLOAD_COMPLETE: "notifyDownloadComplete",
  NOTIFY_NEW_EPISODE: "notifyNewEpisode",
  // TMDB metadata lang (BCP-47 locale, e.g. "de-DE")
  TMDB_LANG: "tmdbLang",
  // Intro skip (anime only, HiAnime source)
  // Values: "off" | "auto" | "manual"
  INTRO_SKIP_MODE: "introSkipMode",
  // Autoplay next preferences
  AUTOPLAY_NEXT_ENABLED: "autoplayNextEnabled",
  AUTOPLAY_NEXT_DURATION: "autoplayNextDuration",
  AUTOPLAY_NEXT_LAYOUT: "autoplayNextLayout",
  // Download page UI preferences
  DL_SORT_BY: "dlSortBy",
  DL_SORT_DIR: "dlSortDir",
  DL_SHOW_UNTRACKED: "dlShowUntracked",
  // Cache for new-episode startup check
  EPISODE_RELEASE_CACHE: "episodeReleaseCache",
  // Per-episode fallback source when the default (typically HiAnime) lacks
  // the title. Shape: { [epKey]: sourceId }.
  SOURCE_FAILOVER_CACHE: "sourceFailoverCache",
};

export const getApiKey = () => storage.get(STORAGE_KEYS.API_KEY);

// ── Source failover cache ────────────────────────────────────────────────────
// HiAnime doesn't always have every episode; rather than nag the user every
// time, remember the working alternate source per (tmdbId, season, ep, dub).
// Max 200 entries
const FAILOVER_CACHE_MAX = 200;

export const getFailoverSource = (epKey) => {
  const cache = storage.get(STORAGE_KEYS.SOURCE_FAILOVER_CACHE) || {};
  return cache[epKey]?.sourceId || null;
};

export const setFailoverSource = (epKey, sourceId) => {
  const cache = storage.get(STORAGE_KEYS.SOURCE_FAILOVER_CACHE) || {};
  // Evict oldest entries when at capacity (insertion order via Object.keys)
  const keys = Object.keys(cache);
  if (keys.length >= FAILOVER_CACHE_MAX) {
    const evict = keys.slice(0, keys.length - FAILOVER_CACHE_MAX + 1);
    evict.forEach((k) => delete cache[k]);
  }
  cache[epKey] = { sourceId, ts: Date.now() };
  storage.set(STORAGE_KEYS.SOURCE_FAILOVER_CACHE, cache);
};

export const clearFailoverSource = (epKey) => {
  const cache = storage.get(STORAGE_KEYS.SOURCE_FAILOVER_CACHE) || {};
  if (cache[epKey] !== undefined) {
    delete cache[epKey];
    storage.set(STORAGE_KEYS.SOURCE_FAILOVER_CACHE, cache);
  }
};

// ── Shared helpers ────────────────────────────────────────────────────────────

/** True when the Streambert server API (public/web-bridge.js) is available. */
export const hasBackend = typeof window !== "undefined" && !!window.api;

/** Format a byte count into a human-readable string. */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "…";
  if (bytes === -1) return null; // unavailable
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// ── Secure storage for sensitive keys ────────────────────────────────────────
// Stored on the Streambert server (data folder), never in localStorage.
// All methods are async; without the server API they are no-ops.
//
// Sensitive keys managed here (NOT stored in localStorage):
//   "apikey"      - TMDB API key
//   "subdlApiKey" - SubDL API key
//   "wyzieApiKey" - Wyzie API key

const _hasSecureStore =
  typeof window !== "undefined" && !!window.api?.secureGet;

export const secureStorage = {
  /** Read a stored secret. Returns null if not set. */
  async get(key) {
    if (!_hasSecureStore) return null;
    return window.api.secureGet(key);
  },

  /** Write a secret. Pass null/empty to delete. */
  async set(key, value) {
    if (!_hasSecureStore) return;
    return window.api.secureSet(key, value ?? "");
  },
};

/**
 * Clears all app caches (browser Cache Storage), AniList, EpisodeGroup,
 * AniSkip, and dlDur_ keys. Single source of truth used by Settings
 * "Clear Cache" button and post-update cache clearing in App.jsx.
 */
export async function clearAppCaches() {
  if (hasBackend) {
    try {
      await window.api.clearAppCache();
    } catch {}
  }
  localStorage.removeItem("streambert_anilistCache");
  localStorage.removeItem("streambert_episodeGroupCache");
  localStorage.removeItem("streambert_aniskipCache");
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("dlDur_")) localStorage.removeItem(key);
  }
}
