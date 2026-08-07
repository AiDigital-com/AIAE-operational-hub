/**
 * Linear congruential generator ported verbatim from the mockup (same constants), so a given seed
 * always produces the same sequence — no `Math.random()` anywhere in the pacing mock.
 */
export function makeRng(seed: number): () => number {
  let s = seed & 0x7fffffff;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Derives a stable seed from a string id (a real campaign id), so the same id always drives the same
 * pseudo-random sequence across renders, reloads, and sessions.
 */
export function seedFromId(id: string): number {
  return [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 7) * 131;
}
