// -- Audio & subtitle picker (Spanish / English only) ---------------------------
// Vidrift exposes a postMessage API (https://vidrift.net/docs): the player sends
// `vidrift:state` with the available audio tracks and subtitles, and accepts
// `vidrift:set` to switch them. Vidrift's own menus are hidden (see the `hide`
// param in api.js) and this control offers only Latin American Spanish and English.
//
// Remembers the choice (playerAudioLang / playerSubLang) and applies it
// automatically whenever a new title or server reports its tracks.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { storage, STORAGE_KEYS } from "../utils/storage";

const VIDRIFT_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*vidrift\.(net|in)$/i;

const ES_RE = /\b(spanish|español|espanol|castellano|latino|latin american|spa)\b/i;
const EN_RE = /\b(english|inglés|ingles|eng)\b/i;
const LATAM_RE = /\b(latin american|latin america|latino|latina|latam|hispanoamérica|hispanoamerica|419|mx|mexico|méxico)\b/i;
// Spain Spanish (Castilian) is excluded: only Latin American Spanish is offered.
const SPAIN_RE = /\b(castellano|castilian|spain|españa|espana|european|es-es|es_es|iberian)\b/i;

const LANG_NAME = { es: "Español", en: "English" };

// Language of an audio track. "Original" is the title's original language.
function audioLang(opt, originalLang) {
  const label = String(opt?.label || "").trim();
  if (/^original$/i.test(label) || /\boriginal\b/i.test(label)) {
    if (originalLang === "es" || originalLang === "en") return originalLang;
    if (ES_RE.test(label)) return "es";
    if (EN_RE.test(label)) return "en";
    return null;
  }
  if (ES_RE.test(label)) return "es";
  if (EN_RE.test(label)) return "en";
  return null;
}

// Language of a subtitle track, from its value ("es", "en-2", "mb-es") or label.
function subLang(opt) {
  const m = /^(?:mb-)?([a-z]{2,3})(?:[-_].*)?$/i.exec(String(opt?.value || ""));
  const code = m?.[1]?.toLowerCase();
  if (code === "es" || code === "spa") return "es";
  if (code === "en" || code === "eng") return "en";
  const label = String(opt?.label || "");
  if (ES_RE.test(label)) return "es";
  if (EN_RE.test(label)) return "en";
  return null;
}

// Builds the Spanish/English-only option lists from a vidrift:state payload.
function buildOptions(state, originalLang) {
  const rawAudios = Array.isArray(state?.audios) ? state.audios : [];
  // A single track is not listed: treat it as the original audio
  const audiosSrc = rawAudios.length
    ? rawAudios
    : [{ value: state?.audio ?? "0", label: "Original", single: true }];

  const audios = [];
  for (const a of audiosSrc) {
    const lang = audioLang(a, originalLang);
    if (!lang) continue;
    const isOriginal = /original/i.test(a.label);
    let label = LANG_NAME[lang];
    if (lang === "es") {
      // Dubs: Latin American only. The original Spanish audio of a
      // Spanish-language title is kept (it is not a dub).
      if (!isOriginal && (!LATAM_RE.test(a.label) || SPAIN_RE.test(a.label))) continue;
      label = isOriginal ? "Español" : "Español (Latino)";
    }
    if (isOriginal) label += " · Original";
    audios.push({ value: String(a.value), label, lang, single: !!a.single });
  }

  const subtitles = [];
  const counts = { es: 0, en: 0 };
  let offValue = null;
  for (const s of Array.isArray(state?.subtitles) ? state.subtitles : []) {
    if (/^(off|none|disabled)$/i.test(String(s.value)) || /^off$/i.test(s.label || "")) {
      offValue = String(s.value);
      continue;
    }
    const lang = subLang(s);
    if (!lang) continue;
    const tag = `${s.value} ${s.label || ""}`;
    if (lang === "es" && SPAIN_RE.test(tag)) continue; // Spain Spanish
    subtitles.push({
      value: String(s.value),
      lang,
      latam: lang === "es" && LATAM_RE.test(tag),
    });
  }

  // Spanish (Latin American first) before English; at most 3 per language
  const rank = (t) => (t.lang === "es" ? (t.latam ? 0 : 1) : 2);
  subtitles.sort((a, b) => rank(a) - rank(b));
  for (const t of subtitles) {
    counts[t.lang] += 1;
    t.n = counts[t.lang];
  }
  const trimmed = subtitles.filter((t) => t.n <= 3);
  subtitles.length = 0;
  for (const t of trimmed) {
    const base = t.lang === "es" ? (t.latam ? "Español (Latino)" : "Español") : "English";
    subtitles.push({ ...t, label: t.n === 1 ? base : `${base} ${t.n}` });
  }
  audios.sort((a, b) => (a.lang === b.lang ? 0 : a.lang === "es" ? -1 : 1));

  const qualities = (Array.isArray(state?.qualities) ? state.qualities : []).map((q) => ({
    value: String(q.value),
    label: q.label || String(q.value),
  }));

  return { audios, subtitles, offValue: offValue ?? "off", qualities };
}

export default function PlayerLangControls({ frameRef, active, originalLang, titleKey }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [audioPref, setAudioPref] = useState(
    () => storage.get(STORAGE_KEYS.PLAYER_AUDIO_LANG) || "es",
  );
  const [subPref, setSubPref] = useState(
    () => storage.get(STORAGE_KEYS.PLAYER_SUB_LANG) || "off",
  );
  const appliedRef = useRef(""); // key of the track list the prefs were applied to
  const wrapRef = useRef(null);

  const post = useCallback(
    (msg) => {
      try {
        const frame = frameRef.current;
        const win = frame?.contentWindow;
        if (!win) return;
        const origin = new URL(frame.src).origin;
        if (VIDRIFT_ORIGIN.test(origin)) win.postMessage(msg, origin);
      } catch {}
    },
    [frameRef],
  );

  // Listen to the player and poll for state until it answers
  useEffect(() => {
    if (!active) {
      setState(null);
      appliedRef.current = "";
      return;
    }
    const onMessage = (e) => {
      if (!VIDRIFT_ORIGIN.test(e.origin)) return;
      if (e.source !== frameRef.current?.contentWindow) return;
      let data = e.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (data?.type === "vidrift:state") setState(data);
      else if (data?.type === "vidrift:providers") post({ type: "vidrift:get-state" });
    };
    window.addEventListener("message", onMessage);
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      post({ type: "vidrift:get-state" });
      if (tries > 60) clearInterval(timer);
    }, 1500);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, [active, frameRef, post, titleKey]);

  // Reset when the title changes
  useEffect(() => {
    setState(null);
    appliedRef.current = "";
    setOpen(false);
  }, [titleKey]);

  const opts = useMemo(() => buildOptions(state, originalLang), [state, originalLang]);

  // Apply the remembered preferences once per track list (title + server)
  useEffect(() => {
    if (!state) return;
    const key = `${titleKey}|${state.server}|${(state.audios || []).length}|${(state.subtitles || []).length}`;
    if (appliedRef.current === key) return;
    appliedRef.current = key;

    const set = {};
    const wantedAudio = opts.audios.find((a) => a.lang === audioPref && !a.single);
    if (wantedAudio && wantedAudio.value !== String(state.audio)) set.audio = wantedAudio.value;

    const currentSub = String(state.subtitle ?? opts.offValue);
    const currentSubAllowed =
      currentSub === opts.offValue || opts.subtitles.some((s) => s.value === currentSub);
    if (subPref === "off") {
      if (currentSub !== opts.offValue) set.subtitle = opts.offValue;
    } else {
      const wantedSub = opts.subtitles.find((s) => s.lang === subPref);
      if (wantedSub && wantedSub.value !== currentSub) set.subtitle = wantedSub.value;
      else if (!wantedSub && !currentSubAllowed) set.subtitle = opts.offValue;
    }
    if (Object.keys(set).length) post({ type: "vidrift:set", ...set });
  }, [state, opts, audioPref, subPref, titleKey, post]);

  // Close the popover on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!active) return null;

  const currentAudio = opts.audios.find((a) => a.value === String(state?.audio));
  const currentSub = opts.subtitles.find((s) => s.value === String(state?.subtitle));
  const summary = state
    ? `${currentAudio ? currentAudio.label.split(" · ")[0] : "Audio"} · ${
        currentSub ? `Sub ${currentSub.lang.toUpperCase()}` : "Sub Off"
      }`
    : "Audio & Subtitles";

  // Send a change, reflect it in the UI right away (the player may not push a
  // new state), then re-query a few times to confirm what it actually applied.
  const applyChange = (change) => {
    post({ type: "vidrift:set", ...change });
    setState((prev) => (prev ? { ...prev, ...change } : prev));
    for (const ms of [400, 1200, 2500]) {
      setTimeout(() => post({ type: "vidrift:get-state" }), ms);
    }
  };
  const chooseAudio = (a) => {
    setAudioPref(a.lang);
    storage.set(STORAGE_KEYS.PLAYER_AUDIO_LANG, a.lang);
    if (!a.single) applyChange({ audio: a.value });
  };
  const chooseSub = (s) => {
    const lang = s ? s.lang : "off";
    setSubPref(lang);
    storage.set(STORAGE_KEYS.PLAYER_SUB_LANG, lang);
    applyChange({ subtitle: s ? s.value : opts.offValue });
  };
  const chooseQuality = (q) => applyChange({ quality: q.value });

  return (
    <div className="lang-ctl" ref={wrapRef}>
      <button
        type="button"
        className="player-overlay-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Audio & Subtitles"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="5" width="19" height="14" rx="3" />
          <path d="M7 13h3M13 13h4M7 16h6M15 16h2" />
        </svg>
        {summary}
      </button>

      {open && (
        <div className="lang-ctl__menu glass-popover" role="menu">
          {!state ? (
            <div className="lang-ctl__note">Connecting to the player…</div>
          ) : (
            <>
              <div className="lang-ctl__section">Audio</div>
              {opts.audios.length ? (
                opts.audios.map((a) => (
                  <button
                    key={`a-${a.value}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={a.value === String(state.audio)}
                    className={`lang-ctl__item${a.value === String(state.audio) ? " is-active" : ""}`}
                    onClick={() => chooseAudio(a)}
                  >
                    {a.label}
                  </button>
                ))
              ) : (
                <div className="lang-ctl__note">
                  This server has no Latin American Spanish or English audio. Try another server in the player.
                </div>
              )}

              <div className="lang-ctl__section">Subtitles</div>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!currentSub}
                className={`lang-ctl__item${!currentSub ? " is-active" : ""}`}
                onClick={() => chooseSub(null)}
              >
                Off
              </button>
              {opts.subtitles.map((s) => (
                <button
                  key={`s-${s.value}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={s.value === String(state.subtitle)}
                  className={`lang-ctl__item${s.value === String(state.subtitle) ? " is-active" : ""}`}
                  onClick={() => chooseSub(s)}
                >
                  {s.label}
                </button>
              ))}
              {!opts.subtitles.length && (
                <div className="lang-ctl__note">No Spanish or English subtitles on this server.</div>
              )}

              {opts.qualities.length > 1 && (
                <>
                  <div className="lang-ctl__section">Quality</div>
                  {opts.qualities.map((q) => (
                    <button
                      key={`q-${q.value}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={q.value === String(state.quality)}
                      className={`lang-ctl__item${q.value === String(state.quality) ? " is-active" : ""}`}
                      onClick={() => chooseQuality(q)}
                    >
                      {q.label}
                    </button>
                  ))}
                </>
              )}
              <div className="lang-ctl__note">
                ¿Se abren anuncios al hacer clic? Instala uBlock Origin o usa el navegador Brave.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
