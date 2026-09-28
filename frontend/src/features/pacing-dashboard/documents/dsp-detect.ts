import { DSP_REGISTRY } from "./constants/dsp-registry";

/**
 * Detects which DSP a free-text custom-link name refers to, tolerant of the many ways people type
 * them ("DV360", "dv 360", "dv", "The Trade Desk", "TTD", ...). A TypeScript port of the retired
 * SPA's `dsp-detect.js`, behaviour-identical and covered by the same golden cases.
 *
 * Matching is WHOLE-TOKEN (not substring), so short aliases like "dv" match the token "dv" but
 * never the "dv" inside "advanced". That is not an optimisation - it is the whole reason the
 * candidate set below exists.
 */

/** Lowercase, non-alphanumeric runs to single spaces, trimmed. */
function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * All contiguous whole-token n-grams of a name, in both spaced and compact form.
 * "dv 360 client" -> {dv, dv360, dv 360, 360, 360 client, 360client, client, ...}.
 * The whole-token basis is what prevents "dv" from matching inside "advanced".
 */
function candidates(name: unknown): Set<string> {
  const norm = normalize(name);
  const set = new Set<string>();
  if (!norm) return set;
  const tokens = norm.split(" ");
  for (let i = 0; i < tokens.length; i++) {
    let spaced = "";
    for (let j = i; j < tokens.length; j++) {
      spaced = spaced ? `${spaced} ${tokens[j]}` : tokens[j];
      set.add(spaced);
      set.add(spaced.replace(/ /g, ""));
    }
  }
  return set;
}

/** The canonical DSP key (`dv360`, `ttd`, ...) a link name refers to, or null when it is not one. */
export function detectDsp(name: unknown): string | null {
  const cand = candidates(name);
  if (cand.size === 0) return null;
  for (const dsp of DSP_REGISTRY) {
    for (const alias of dsp.aliases) {
      const normalized = normalize(alias);
      if (cand.has(normalized) || cand.has(normalized.replace(/ /g, ""))) return dsp.key;
    }
  }
  return null;
}

/** Canonical display label for a DSP key, or null if unknown. */
export function dspLabel(key: string): string | null {
  return DSP_REGISTRY.find((dsp) => dsp.key === key)?.label ?? null;
}
