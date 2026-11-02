// -- <WebView>: sandboxed <iframe> for embedded players and trailers ------------
// The pages talk to the player through a small API (originally modelled on a
// webview). The ref receives the <iframe> element, extended with:
//
//   executeJavaScript(code) → runs in the frame when it is same-origin (e.g. the
//                             HiAnime player served by our own server); resolves
//                             to null for cross-origin embeds the browser can't
//                             inspect.
//   addEventListener        → "dom-ready"/"did-finish-load" map to "load",
//                             "did-fail-load" maps to "error"; other legacy
//                             events (before-input-event, …) are ignored.

import { forwardRef, useCallback } from "react";

const EVENT_MAP = {
  "dom-ready": "load",
  "did-finish-load": "load",
  "did-stop-loading": "load",
  "did-fail-load": "error",
};
const IGNORED_EVENTS = new Set([
  "before-input-event",
  "will-navigate",
  "did-navigate",
  "did-navigate-in-page",
  "console-message",
  "ipc-message",
  "new-window",
  "enter-html-full-screen",
  "leave-html-full-screen",
  "media-started-playing",
  "media-paused",
  "crashed",
  "render-process-gone",
]);

// Evaluate `code` against a same-origin frame. Tries the frame's own eval first;
// if its CSP forbids eval, falls back to evaluating in this realm with the
// frame's globals (document, window, …) in scope.
function evalInFrame(win, code) {
  try {
    return win.eval(code);
  } catch (e) {
    // Only a CSP eval block falls through; real script errors propagate.
    if (e?.name !== "EvalError") throw e;
  }
  const scope = new Proxy(win, {
    has: (t, k) => typeof k === "string" && k !== "eval" && k !== "__code" && k in t,
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      const v = t[k];
      // Bind plain functions (setTimeout, getComputedStyle, …) to the frame
      // window; leave constructors (Event, HTMLVideoElement, …) untouched.
      return typeof v === "function" && typeof k === "string" && !/^[A-Z]/.test(k)
        ? v.bind(t)
        : v;
    },
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
  // eslint-disable-next-line no-new-func
  return new Function("__scope", "__code", "with (__scope) { return eval(__code); }")(
    scope,
    code,
  );
}

function enhanceIframe(el) {
  if (!el || el.__sbEnhanced) return;
  el.__sbEnhanced = true;

  const nativeAdd = el.addEventListener.bind(el);
  const nativeRemove = el.removeEventListener.bind(el);
  el.addEventListener = (type, fn, opts) => {
    if (IGNORED_EVENTS.has(type)) return;
    nativeAdd(EVENT_MAP[type] || type, fn, opts);
  };
  el.removeEventListener = (type, fn, opts) => {
    if (IGNORED_EVENTS.has(type)) return;
    nativeRemove(EVENT_MAP[type] || type, fn, opts);
  };

  el.executeJavaScript = (code) => {
    try {
      const win = el.contentWindow;
      if (!win) return Promise.resolve(null);
      // Throws SecurityError for cross-origin frames
      void win.document;
      return Promise.resolve(evalInFrame(win, code)).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };
}

const WebView = forwardRef(function WebView({ sandbox, ...props }, ref) {
  const setRef = useCallback(
    (el) => {
      enhanceIframe(el);
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  // Without allow-popups / allow-top-navigation the embed can't open ad popups
  // or redirect the app.
  const base = sandbox || "allow-scripts allow-same-origin allow-forms";
  return (
    <iframe
      ref={setRef}
      title="Player"
      sandbox={`${base} allow-presentation allow-pointer-lock`}
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowFullScreen
      referrerPolicy="origin"
      {...props}
    />
  );
});

export default WebView;
