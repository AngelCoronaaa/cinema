// ── Shared subtitle helpers ───────────────────────────────────────────────────

// Only Spanish and English are offered (player, downloads and search).
export const SUBTITLE_LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
];

export const LANG_LABEL = Object.fromEntries(
  SUBTITLE_LANGUAGES.map((l) => [l.code, l.label]),
);

/** Return the style props for a source badge (SubDL / Wyzie) */
export function sourceBadgeStyle(sub) {
  const isSubDL = sub.via_subdl;
  return {
    fontSize: 9,
    fontWeight: 700,
    padding: "1px 5px",
    borderRadius: 3,
    background: isSubDL ? "rgba(99,149,255,0.15)" : "rgba(180,130,255,0.15)",
    color: isSubDL ? "#6395ff" : "#b482ff",
    border: `1px solid ${isSubDL ? "rgba(99,149,255,0.3)" : "rgba(180,130,255,0.3)"}`,
    textTransform: "uppercase",
    flexShrink: 0,
  };
}

export function sourceBadgeLabel(sub) {
  if (sub.via_subdl) return "SubDL";
  return "Wyzie";
}
