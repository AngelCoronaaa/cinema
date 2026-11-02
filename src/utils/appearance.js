// ── Accent colour presets & helpers ──────────────────────────────────────────
// Kept in a separate file so both App.jsx and SettingsPage.jsx can import
// without creating a circular dependency.

export const ACCENT_PRESETS = [
  {
    id: "blue",
    label: "Blue",
    color: "#0071e3",
    color2: "#2997ff",
    dim: "rgba(0,113,227,0.16)",
    glow: "0 8px 24px rgba(0,113,227,0.28)",
  },
  {
    id: "red",
    label: "Red",
    color: "#e50914",
    color2: "#ff1a24",
    dim: "rgba(229,9,20,0.15)",
    glow: "0 0 30px rgba(229,9,20,0.3)",
  },
  {
    id: "purple",
    label: "Purple",
    color: "#7c3aed",
    color2: "#8b5cf6",
    dim: "rgba(124,58,237,0.15)",
    glow: "0 0 30px rgba(124,58,237,0.3)",
  },
  {
    id: "green",
    label: "Green",
    color: "#059669",
    color2: "#10b981",
    dim: "rgba(5,150,105,0.15)",
    glow: "0 0 30px rgba(5,150,105,0.3)",
  },
  {
    id: "orange",
    label: "Orange",
    color: "#d97706",
    color2: "#f59e0b",
    dim: "rgba(217,119,6,0.15)",
    glow: "0 0 30px rgba(217,119,6,0.3)",
  },
  {
    id: "pink",
    label: "Pink",
    color: "#db2777",
    color2: "#ec4899",
    dim: "rgba(219,39,119,0.15)",
    glow: "0 0 30px rgba(219,39,119,0.3)",
  },
];

export function applyAccentColor(presetId) {
  const preset =
    ACCENT_PRESETS.find((p) => p.id === presetId) ?? ACCENT_PRESETS[0];
  const root = document.documentElement;
  root.style.setProperty("--red", preset.color);
  root.style.setProperty("--red2", preset.color2);
  root.style.setProperty("--red-dim", preset.dim);
  root.style.setProperty("--red-glow", preset.glow);
}

// ── Theme presets ─────────────────────────────────────────────────────────────
// Colours live in src/styles/liquid-glass.css as light/dark token sets.
// "system" follows the OS appearance (prefers-color-scheme) and switches live.
// `preview` is only used for the swatch in Settings.
export const THEME_PRESETS = [
  {
    id: "system",
    label: "Automatic",
    description: "Follows your system's light or dark appearance",
    preview: ["#f5f5f7", "#1c1c1e"],
  },
  {
    id: "light",
    label: "Light",
    description: "Light appearance with Liquid Glass",
    preview: ["#f5f5f7", "#ffffff"],
  },
  {
    id: "dark",
    label: "Dark",
    description: "Dark appearance with Liquid Glass",
    preview: ["#000000", "#1c1c1e"],
  },
];

export const DEFAULT_THEME = "system";

// Older theme ids (amoled, mocha, slate, custom) map onto the new set.
export function normalizeTheme(themeId) {
  if (themeId === "light" || themeId === "dark" || themeId === "system") return themeId;
  if (!themeId) return DEFAULT_THEME;
  return "dark";
}

/** Kept for backwards compatibility with saved settings; no longer editable. */
export const DEFAULT_CUSTOM_VARS = {};

const LEGACY_VARS = [
  "--bg", "--surface", "--surface2", "--surface3",
  "--border", "--text", "--text2", "--text3",
];

/**
 * Apply a theme by id ("system" | "light" | "dark").
 * Sets data-theme on <html>; the CSS token sets do the rest.
 */
export function applyTheme(themeId) {
  const id = normalizeTheme(themeId);
  const root = document.documentElement;
  // Remove inline colours written by the previous theme system
  for (const prop of LEGACY_VARS) root.style.removeProperty(prop);
  if (id === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", id);
}
