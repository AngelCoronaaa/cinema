// ── Settings: appearance only ─────────────────────────────────────────────────
// Streambert is shared by several people, so the only settings exposed are the
// ones that affect how the app looks for the person using this browser. They
// are stored in this browser (localStorage) and applied immediately.
// Everything that affects all users (TMDB token, subtitle keys, …) is
// configured on the server (.env).

import { useEffect, useState } from "react";
import { storage, STORAGE_KEYS } from "../utils/storage";
import {
  ACCENT_PRESETS,
  applyAccentColor,
  THEME_PRESETS,
  applyTheme,
  normalizeTheme,
} from "../utils/appearance";
import { applyTvMode, getTvPreference, isTvDevice, TV_MODE_KEY } from "../utils/tvMode";

const TV_MODES = [
  { id: "auto", label: "Automatic" },
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
];

const FONT_SIZES = [
  { id: "sm", label: "Small", zoom: 0.85 },
  { id: "normal", label: "Normal", zoom: 1 },
  { id: "lg", label: "Large", zoom: 1.15 },
];

function Toggle({ value, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      className={`settings-toggle${value ? " is-on" : ""}`}
      onClick={() => onChange(!value)}
    >
      <span className="settings-toggle__knob" />
    </button>
  );
}

function Row({ title, description, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <div className="settings-row__title">{title}</div>
        {description && <div className="settings-row__desc">{description}</div>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const [theme, setTheme] = useState(() => normalizeTheme(storage.get(STORAGE_KEYS.THEME)));
  const [accent, setAccent] = useState(() => storage.get(STORAGE_KEYS.ACCENT_COLOR) || "blue");
  const [fontSize, setFontSize] = useState(() => storage.get(STORAGE_KEYS.FONT_SIZE) || "normal");
  const [compact, setCompact] = useState(() => !!storage.get(STORAGE_KEYS.COMPACT_MODE));
  const [noAnim, setNoAnim] = useState(() => !!storage.get(STORAGE_KEYS.REDUCE_ANIMATIONS));
  const [tvMode, setTvMode] = useState(getTvPreference);

  // Apply + persist every change right away
  useEffect(() => {
    storage.set(STORAGE_KEYS.THEME, theme);
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    storage.set(STORAGE_KEYS.ACCENT_COLOR, accent);
    applyAccentColor(accent);
    // The player picks up the accent colour (App.jsx → playerSettings)
    window.dispatchEvent(new CustomEvent("streambert:player-settings-changed"));
  }, [accent]);

  useEffect(() => {
    storage.set(STORAGE_KEYS.FONT_SIZE, fontSize);
    const zoom = FONT_SIZES.find((f) => f.id === fontSize)?.zoom ?? 1;
    window.api?.setZoomFactor?.(zoom);
  }, [fontSize]);

  useEffect(() => {
    storage.set(STORAGE_KEYS.COMPACT_MODE, compact ? 1 : 0);
    document.body.classList.toggle("compact-mode", compact);
  }, [compact]);

  useEffect(() => {
    storage.set(STORAGE_KEYS.REDUCE_ANIMATIONS, noAnim ? 1 : 0);
    document.body.classList.toggle("no-anim", noAnim);
  }, [noAnim]);

  useEffect(() => {
    storage.set(TV_MODE_KEY, tvMode);
    applyTvMode(tvMode);
  }, [tvMode]);

  const currentTheme = THEME_PRESETS.find((t) => t.id === theme);
  const currentAccent = ACCENT_PRESETS.find((p) => p.id === accent);

  return (
    <div className="settings-page fade-in">
      <h1 className="page-title">Settings</h1>
      <p className="settings-page__intro">
        These settings only apply to this browser.
      </p>

      <section className="settings-card" aria-labelledby="appearance-title">
        <h2 id="appearance-title" className="settings-card__title">
          Appearance
        </h2>

        <Row title="Theme" description={currentTheme?.description}>
          <div className="theme-picker" role="radiogroup" aria-label="Theme">
            {THEME_PRESETS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                className={`theme-option${theme === t.id ? " is-active" : ""}`}
                onClick={() => setTheme(t.id)}
              >
                <span
                  className="theme-option__swatch"
                  style={{
                    background: `linear-gradient(135deg, ${t.preview[0]} 50%, ${t.preview[1]} 50%)`,
                  }}
                />
                <span className="theme-option__label">{t.label}</span>
              </button>
            ))}
          </div>
        </Row>

        <Row
          title="Accent colour"
          description={`${currentAccent?.label ?? ""} · buttons, highlights and the player`}
        >
          <div className="accent-picker" role="radiogroup" aria-label="Accent colour">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={accent === p.id}
                aria-label={p.label}
                title={p.label}
                className={`accent-option${accent === p.id ? " is-active" : ""}`}
                style={{ "--swatch": p.color }}
                onClick={() => setAccent(p.id)}
              />
            ))}
          </div>
        </Row>

        <Row title="Text size">
          <div className="segmented" role="radiogroup" aria-label="Text size">
            {FONT_SIZES.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={fontSize === f.id}
                className={`segmented__item${fontSize === f.id ? " is-active" : ""}`}
                onClick={() => setFontSize(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </Row>

        <Row
          title="TV mode"
          description={`Larger interface and remote-control navigation.${
            isTvDevice() ? " This device was detected as a TV." : ""
          }`}
        >
          <div className="segmented" role="radiogroup" aria-label="TV mode">
            {TV_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={tvMode === m.id}
                className={`segmented__item${tvMode === m.id ? " is-active" : ""}`}
                onClick={() => setTvMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </Row>

        <Row title="Compact grid" description="Shows more titles per row with smaller cards.">
          <Toggle value={compact} onChange={setCompact} label="Compact grid" />
        </Row>

        <Row title="Reduce animations" description="Turns off transitions and hover effects.">
          <Toggle value={noAnim} onChange={setNoAnim} label="Reduce animations" />
        </Row>
      </section>
    </div>
  );
}
