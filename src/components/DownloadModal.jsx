// ── Download to this device ───────────────────────────────────────────────────
// Everything is saved by the browser on the device of the person who clicks:
//   · Video: the server remuxes the stream (HLS → MP4) while the browser
//     downloads it (server/ipc/export.js). Nothing is stored on the server.
//   · Subtitles: the stream's own subtitles plus a Spanish/English search
//     (SubDL / Wyzie), delivered as .srt files.

import { useCallback, useEffect, useState } from "react";
import { CloseIcon, DownloadIcon, SubtitlesIcon } from "./Icons";
import { secureStorage, STORAGE_KEYS, storage } from "../utils/storage";
import { SUBTITLE_LANGUAGES, LANG_LABEL } from "../utils/subtitles";

// Starts a browser download for a same-origin URL (the server sends
// Content-Disposition: attachment, so the page stays where it is).
function startBrowserDownload(url) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const langName = (code) => {
  const c = String(code || "").toLowerCase();
  if (c.startsWith("es") || c.startsWith("spa")) return "Español";
  if (c.startsWith("en")) return "English";
  return LANG_LABEL[c] || c.toUpperCase() || "Subtitles";
};

export default function DownloadModal({
  onClose,
  m3u8Url,
  subtitles = [],
  mediaName,
  mediaType,
  season,
  episode,
  tmdbId,
}) {
  const [videoState, setVideoState] = useState("idle"); // idle | preparing | started | error
  const [videoError, setVideoError] = useState("");
  const [streamSubs, setStreamSubs] = useState([]); // [{ lang, url }]

  const [keys, setKeys] = useState(null); // { wyzie, subdl } once loaded
  const [lang, setLang] = useState(() => storage.get(STORAGE_KEYS.SUBTITLE_LANG) || "es");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [savedIds, setSavedIds] = useState(() => new Set());

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Subtitle keys (configured on the server)
  useEffect(() => {
    let alive = true;
    Promise.all([
      secureStorage.get(STORAGE_KEYS.WYZIE_API_KEY),
      secureStorage.get(STORAGE_KEYS.SUBDL_API_KEY),
    ]).then(([wyzie, subdl]) => alive && setKeys({ wyzie: wyzie || "", subdl: subdl || "" }));
    return () => {
      alive = false;
    };
  }, []);

  const canSearch = !!tmdbId && !!keys && !!(keys.wyzie || keys.subdl);

  const search = useCallback(
    async (language) => {
      if (!canSearch) return;
      setSearching(true);
      setSearchError("");
      setResults(null);
      try {
        const res = await window.api.searchSubtitles({
          tmdbId,
          mediaType,
          season,
          episode,
          languages: language,
          subdlApiKey: keys.subdl,
          wyzieApiKey: keys.wyzie,
        });
        if (!res?.ok) {
          setSearchError(res?.error || "Search failed");
          setResults([]);
        } else {
          setResults(res.results || []);
        }
      } catch (e) {
        setSearchError(e.message);
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [canSearch, tmdbId, mediaType, season, episode, keys],
  );

  useEffect(() => {
    if (canSearch) search(lang);
  }, [canSearch, lang, search]);

  const prepare = () =>
    window.api.prepareDownload({
      url: m3u8Url,
      title: mediaName,
      subtitles: subtitles.map((s) => ({ url: s.url, lang: s.lang })),
    });

  const downloadVideo = async () => {
    if (!m3u8Url) return;
    setVideoState("preparing");
    setVideoError("");
    try {
      const res = await prepare();
      if (!res?.ok) throw new Error(res?.error || "This stream can't be downloaded.");
      startBrowserDownload(res.video);
      setStreamSubs(res.subtitles || []);
      setVideoState("started");
    } catch (e) {
      setVideoError(e.message);
      setVideoState("error");
    }
  };

  // Stream subtitles can also be fetched on their own
  const downloadStreamSub = async (index) => {
    let list = streamSubs;
    if (!list.length) {
      const res = await prepare();
      list = res?.subtitles || [];
      setStreamSubs(list);
    }
    if (list[index]) startBrowserDownload(list[index].url);
  };

  const downloadSearchSub = (r) => {
    const q = new URLSearchParams({
      fileId: r.file_id,
      title: mediaName || "Subtitle",
      lang: String(r.language || lang).slice(0, 5),
    });
    startBrowserDownload(`/api/export/subtitle?${q}`);
    setSavedIds((prev) => new Set(prev).add(r.file_id));
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dl-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dl-sheet glass">
        <header className="dl-sheet__header">
          <div>
            <h2 id="dl-title" className="dl-sheet__title">
              Download
            </h2>
            <p className="dl-sheet__subtitle">{mediaName}</p>
          </div>
          <button type="button" className="dl-sheet__close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        {/* Video */}
        <section className="dl-sheet__section">
          <h3 className="dl-sheet__label">Video</h3>
          {m3u8Url ? (
            <>
              <button
                type="button"
                className="btn btn-primary dl-sheet__primary"
                onClick={downloadVideo}
                disabled={videoState === "preparing"}
              >
                <DownloadIcon />
                {videoState === "preparing"
                  ? "Preparing…"
                  : videoState === "started"
                    ? "Download again"
                    : "Download to this device (MP4)"}
              </button>
              {videoState === "started" && (
                <p className="dl-sheet__ok" role="status">
                  ✓ Download started. Your browser saves it like any other download; follow it in
                  its downloads list.
                </p>
              )}
              {videoState === "error" && (
                <p className="dl-sheet__error" role="alert">
                  {videoError}
                </p>
              )}
              <p className="dl-sheet__hint">
                Best available quality. The total size isn't known in advance, so the progress
                shows the megabytes downloaded so far.
              </p>
            </>
          ) : (
            <p className="dl-sheet__hint">
              This player runs on another website, so its video can't be saved from the browser.
              Downloads work with the <b>HiAnime</b> source (anime): choose it in the player's
              source menu and press Download again.
            </p>
          )}
        </section>

        {/* Subtitles that come with the stream */}
        {m3u8Url && subtitles.length > 0 && (
          <section className="dl-sheet__section">
            <h3 className="dl-sheet__label">Subtitles from this stream</h3>
            <div className="dl-sheet__chips">
              {subtitles.map((s, i) => (
                <button
                  key={s.url}
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => downloadStreamSub(i)}
                >
                  <SubtitlesIcon /> {langName(s.lang)} (.srt)
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Subtitle search */}
        {tmdbId && (
          <section className="dl-sheet__section">
            <div className="dl-sheet__row">
              <h3 className="dl-sheet__label">Find subtitles</h3>
              <div className="segmented" role="radiogroup" aria-label="Subtitle language">
                {SUBTITLE_LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    role="radio"
                    aria-checked={lang === l.code}
                    className={`segmented__item${lang === l.code ? " is-active" : ""}`}
                    onClick={() => setLang(l.code)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {keys && !canSearch ? (
              <p className="dl-sheet__hint">
                Subtitle search isn't set up on this server (WYZIE_API_KEY or SUBDL_API_KEY in
                .env).
              </p>
            ) : searching || !keys ? (
              <div className="loader" style={{ padding: 20 }}>
                <div className="spinner" />
              </div>
            ) : searchError ? (
              <p className="dl-sheet__error">{searchError}</p>
            ) : results && results.length === 0 ? (
              <p className="dl-sheet__hint">No {langName(lang)} subtitles found.</p>
            ) : (
              <ul className="dl-sheet__list">
                {(results || []).slice(0, 20).map((r) => (
                  <li key={r.file_id} className="dl-sheet__item">
                    <div className="dl-sheet__item-text">
                      <span className="dl-sheet__item-name">
                        {r.release || r.file_name || "Subtitle"}
                      </span>
                      <span className="dl-sheet__item-meta">
                        {langName(r.language)} · {r.via_subdl ? "SubDL" : "Wyzie"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary dl-sheet__item-btn"
                      onClick={() => downloadSearchSub(r)}
                      aria-label={`Download subtitle ${r.release || r.file_name || ""}`}
                    >
                      {savedIds.has(r.file_id) ? "✓" : <DownloadIcon />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
