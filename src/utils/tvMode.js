// ── TV mode (10-foot UI) ───────────────────────────────────────────────────────
// · Detects TV browsers (Samsung Tizen, LG webOS, Android/Google TV, Fire TV,
//   Hisense VIDAA, Philips, Sony BRAVIA, HbbTV, Roku…) or `?tv=1` in the URL.
// · The user can force it on/off in Settings ("tvMode": auto | on | off).
// · When active, <html data-tv> enlarges the UI (see liquid-glass.css) and
//   the remote's arrow keys move focus spatially between controls and cards;
//   OK/Enter activates, the remote's Back key goes back.

import { storage } from "./storage";

const TV_UA =
  /SmartTV|SMART-TV|Tizen|Web0S|WebOS|NetCast|HbbTV|BRAVIA|AFT[A-Z0-9]|Android TV|AndroidTV|GoogleTV|Google TV|CrKey|Roku|Viera|VIDAA|Hisense|Philips|TV Safari|Large Screen|AppleTV|Xbox|PlayStation/i;

export const TV_MODE_KEY = "tvMode";

export function isTvDevice() {
  try {
    if (new URLSearchParams(window.location.search).get("tv") === "1") return true;
  } catch {}
  return TV_UA.test(navigator.userAgent || "");
}

export function getTvPreference() {
  const v = storage.get(TV_MODE_KEY);
  return v === "on" || v === "off" ? v : "auto";
}

export function isTvModeActive(pref = getTvPreference()) {
  return pref === "on" || (pref === "auto" && isTvDevice());
}

export function applyTvMode(pref = getTvPreference()) {
  const on = isTvModeActive(pref);
  document.documentElement.toggleAttribute("data-tv", on);
  return on;
}

// ── Spatial navigation ─────────────────────────────────────────────────────────
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const BACK_KEYS = new Set(["GoBack", "BrowserBack", "Backspace"]);
const BACK_CODES = new Set([461, 10009, 8]); // webOS, Tizen, Backspace

function isVisible(el) {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.05;
}

// The topmost open dialog limits where focus may go
function scopeRoot() {
  const dialogs = [...document.querySelectorAll('[role="dialog"], .modal-overlay, .modal-backdrop')].filter(isVisible);
  return dialogs[dialogs.length - 1] || document;
}

function candidates() {
  return [...scopeRoot().querySelectorAll(FOCUSABLE)].filter(
    (el) => isVisible(el) && !el.closest("[inert]") && el.tagName !== "IFRAME",
  );
}

function center(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function pickNext(from, dir) {
  const fr = from.getBoundingClientRect();
  const fc = center(fr);
  let best = null;
  let bestScore = Infinity;
  for (const el of candidates()) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const r = el.getBoundingClientRect();
    const c = center(r);
    const dx = c.x - fc.x;
    const dy = c.y - fc.y;
    let primary;
    let secondary;
    switch (dir) {
      case "right":
        if (r.left < fr.right - 4 && dx <= 4) continue;
        primary = Math.max(0, r.left - fr.right);
        secondary = Math.abs(dy);
        break;
      case "left":
        if (r.right > fr.left + 4 && dx >= -4) continue;
        primary = Math.max(0, fr.left - r.right);
        secondary = Math.abs(dy);
        break;
      case "down":
        if (r.top < fr.bottom - 4 && dy <= 4) continue;
        primary = Math.max(0, r.top - fr.bottom);
        secondary = Math.abs(dx);
        break;
      default: // up
        if (r.bottom > fr.top + 4 && dy >= -4) continue;
        primary = Math.max(0, fr.top - r.bottom);
        secondary = Math.abs(dx);
    }
    const score = primary + secondary * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function focusEl(el) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(el.type);
}

let installed = false;

export function initTvMode() {
  applyTvMode();
  if (installed) return;
  installed = true;

  window.addEventListener("storage", (e) => {
    if (e.key?.endsWith(TV_MODE_KEY)) applyTvMode();
  });

  window.addEventListener(
    "keydown",
    (e) => {
      if (!document.documentElement.hasAttribute("data-tv")) return;
      const active = document.activeElement;

      // Remote "Back"
      if (BACK_KEYS.has(e.key) || BACK_CODES.has(e.keyCode)) {
        if (isTextField(active) && e.key === "Backspace") return;
        e.preventDefault();
        const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        // Close an open dialog first; otherwise go back
        if (scopeRoot() !== document) document.dispatchEvent(esc);
        else window.history.back();
        return;
      }

      const dir = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" }[e.key];
      if (!dir) return;
      // Let text fields keep left/right for the caret
      if (isTextField(active) && (dir === "left" || dir === "right")) return;
      if (active?.tagName === "SELECT") return;

      const from = active && active !== document.body ? active : null;
      const next = from ? pickNext(from, dir) : candidates().find((el) => el.closest(".main")) || candidates()[0];
      if (next) {
        e.preventDefault();
        focusEl(next);
      }
    },
    true,
  );
}
