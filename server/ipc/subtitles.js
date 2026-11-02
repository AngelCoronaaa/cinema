// ── Subtitles ─────────────────────────────────────────────────────────────────
// Subtitle search (SubDL + Wyzie) and ZIP extraction. The files themselves are
// sent to the user's device by server/ipc/export.js.

const { ipcMain } = require("../runtime");
const path = require("path");
const zlib = require("zlib");

// ── Robust fetch with timeout (explicit AbortController + timer) ──
function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

// ── ZIP subtitle extractor ────────────────────────────────────────────────────

// Max decompressed zip size (10mb) to prevent zip-bombs
const ZIP_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

// Only these extensions are accepted as subtitle files.
const SUBTITLE_EXTS = new Set(["srt", "vtt", "ass", "ssa"]);

function extractFirstSubtitleFromZip(buf) {
  let offset = 0;
  while (offset < buf.length - 30) {
    if (
      buf[offset] === 0x50 &&
      buf[offset + 1] === 0x4b &&
      buf[offset + 2] === 0x03 &&
      buf[offset + 3] === 0x04
    ) {
      const compression = buf.readUInt16LE(offset + 8);
      const compressedSize = buf.readUInt32LE(offset + 18);
      const fileNameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const rawFileName = buf
        .slice(offset + 30, offset + 30 + fileNameLen)
        .toString("utf8");
      const dataOffset = offset + 30 + fileNameLen + extraLen;

      const fileName = path.basename(rawFileName);

      const ext = fileName.toLowerCase().split(".").pop();
      if (SUBTITLE_EXTS.has(ext)) {
        const compressedData = buf.slice(
          dataOffset,
          dataOffset + compressedSize,
        );
        let data;
        if (compression === 0) {
          // Stored (no compression)
          if (compressedData.length > ZIP_MAX_OUTPUT_BYTES) {
            offset = dataOffset + compressedSize;
            continue;
          }
          data = compressedData;
        } else if (compression === 8) {
          // cap the decompressed output to guard against ZIP-bombs
          try {
            data = zlib.inflateRawSync(compressedData, {
              maxOutputLength: ZIP_MAX_OUTPUT_BYTES,
            });
          } catch {
            offset = dataOffset + compressedSize;
            continue;
          }
        } else {
          offset = dataOffset + compressedSize;
          continue;
        }
        return { data, name: fileName };
      }
      offset = dataOffset + compressedSize;
    } else {
      offset++;
    }
  }
  return null;
}

// ── IPC registration ──────────────────────────────────────────────────────────

function register() {
  // ── Subtitle search ────────────────────────────────────────────────────────
  ipcMain.handle(
    "search-subtitles",
    async (
      _,
      {
        tmdbId,
        mediaType,
        season,
        episode,
        languages,
        subdlApiKey,
        wyzieApiKey,
      },
    ) => {
      function toSubDLLang(lang) {
        if (!lang) return "";
        return lang.split("-")[0].toUpperCase();
      }

      async function searchSubDL() {
        try {
          const params = new URLSearchParams({
            api_key: subdlApiKey,
            tmdb_id: String(tmdbId),
            type: mediaType === "tv" ? "tv" : "movie",
            subs_per_page: "30",
          });
          if (mediaType === "tv" && season != null)
            params.set("season_number", String(season));
          if (mediaType === "tv" && episode != null)
            params.set("episode_number", String(episode));
          if (languages) params.set("languages", toSubDLLang(languages));

          const res = await fetchWithTimeout(
            `https://api.subdl.com/api/v1/subtitles?${params}`,
            { headers: { "User-Agent": "Streambert" } },
            12000,
          );
          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            return {
              ok: false,
              error: `SubDL error ${res.status}: ${errText}`,
            };
          }
          const data = await res.json();
          if (!data.status)
            return { ok: false, error: "SubDL returned no results" };
          const results = (data.subtitles || []).map((s) => ({
            file_id: `subdl_${s.sd_id}_${encodeURIComponent(s.url)}`,
            file_name: s.name || s.release_name || "",
            language: (s.lang || "").toLowerCase(),
            release: s.release_name || s.name || "",
            uploader: s.author || "SubDL",
            download_count: s.downloads || 0,
            hearing_impaired: !!s.hi,
            ai_translated: false,
            machine_translated: false,
            ratings: 0,
            fps: null,
            from_trusted: false,
            via_subdl: true,
          }));
          if (results.length === 0)
            return { ok: false, error: "SubDL: no results" };
          return { ok: true, results, via_subdl: true };
        } catch (e) {
          const msg =
            e.name === "AbortError"
              ? "SubDL timed out, server may be temporarily unavailable"
              : e.message;
          return { ok: false, error: msg };
        }
      }

      async function searchWyzie() {
        try {
          const params = new URLSearchParams({
            id: String(tmdbId),
            format: "srt",
          });
          if (languages) params.set("language", languages);
          if (mediaType === "tv" && season != null)
            params.set("season", String(season));
          if (mediaType === "tv" && episode != null)
            params.set("episode", String(episode));

          if (wyzieApiKey) params.set("key", wyzieApiKey);

          const baseUrl = wyzieApiKey
            ? "https://sub.wyzie.io/search"
            : "https://subs.wyzie.ru/search";

          const res = await fetchWithTimeout(`${baseUrl}?${params}`, {}, 12000);
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              return {
                ok: false,
                error: `Wyzie API key invalid or expired (${res.status})`,
                wyzie_auth_error: true,
              };
            }
            return { ok: false, error: `Wyzie error ${res.status}` };
          }
          const data = await res.json();
          const results = (Array.isArray(data) ? data : [])
            .filter((r) => r.url)
            .map((r, i) => {
              const rawUrl = r.url || "";
              const fullUrl = rawUrl.startsWith("http")
                ? rawUrl
                : `https://subs.wyzie.ru${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
              const displayName =
                r.display_name ||
                r.name ||
                r.release_name ||
                r.title ||
                r.SubFileName ||
                r.fileName ||
                "";
              const lang = (r.language || "").toUpperCase();
              const hiTag = r.isHearingImpaired ? " [HI]" : "";
              const aiTag = r.isAiTranslated ? " [AI]" : "";
              const src = r.source ? ` · ${r.source}` : "";
              const fallback = `${lang} subtitle${hiTag}${aiTag}${src} #${i + 1}`;
              return {
                file_id: `wyzie_${i}_${encodeURIComponent(fullUrl)}`,
                direct_url: fullUrl,
                file_name: displayName || fallback,
                language: r.language || "",
                release: displayName || fallback,
                uploader: "Wyzie",
                download_count: 0,
                hearing_impaired: !!r.isHearingImpaired,
                ai_translated: !!r.isAiTranslated,
                machine_translated: false,
                ratings: 0,
                fps: null,
                from_trusted: false,
                via_wyzie: true,
                original_source: r.source || "",
              };
            });
          if (results.length === 0)
            return { ok: false, error: "Wyzie: no results" };
          return { ok: true, results, via_wyzie: true };
        } catch (e) {
          const msg =
            e.name === "AbortError"
              ? "Subtitle service timed out, it may be temporarily down. Try adding a free SubDL API key in Settings for reliable results."
              : e.message;
          return { ok: false, error: msg };
        }
      }
      const errors = [];
      if (subdlApiKey) {
        const r = await searchSubDL();
        if (r.ok) return r;
        errors.push(r.error);
      }
      const r = await searchWyzie();
      if (r.ok) return r;
      errors.push(r.error);
      const allTimedOut = errors.every((e) => e && e.includes("timed out"));
      return {
        ok: false,
        error: allTimedOut
          ? "Subtitle service timed out, it may be temporarily down. Add a free SubDL API key in Settings for reliable results."
          : errors.length > 0
            ? errors.join(" · ")
            : "No subtitles found. Try a different language or add a SubDL API key in Settings.",
      };
    },
  );
}

module.exports = { register, fetchWithTimeout, extractFirstSubtitleFromZip };
