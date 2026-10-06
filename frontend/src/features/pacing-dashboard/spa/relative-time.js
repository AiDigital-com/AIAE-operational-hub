// workspace/src/lib/dashboard/relative-time.js
// The header's "Updated …" words (dashboard refresh spec 2026-10-01). A stamp in the
// future (clock skew between the server and the browser) reads "just now" too.
export function relativeTime(iso, nowMs = Date.now()) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const diff = nowMs - t;
  if (diff < 60_000) return 'just now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
