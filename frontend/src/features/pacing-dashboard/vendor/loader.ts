/**
 * Loads the vendored shared-grammar modules in `./` (see `SOURCE.md`) and hands each back as a
 * typed object.
 *
 * The vendored files are UMD scripts with no `import`/`export` statements: `if (typeof module !==
 * 'undefined' && module.exports) { module.exports = X } else { root.X = X }`. Which branch runs
 * depends on who is asking, and the two environments this code runs in disagree — the same split
 * `../engine/engine-loader.ts` documents and solves, measured there rather than assumed:
 *
 *   - **Vitest** (`vite-node`) provides a `module`/`exports` pair for CJS interop, so the file
 *     populates `module.exports`, which surfaces as the module's `default`. `globalThis.DashBlocks`
 *     stays `undefined`.
 *   - **A real browser** (Vite dev server, native ESM) has no `module` global, so the file attaches
 *     to `globalThis` — and the ES module it is served as has no exports at all.
 *
 * Hence the dynamic `await import(...)` below rather than a static default import, which is resolved
 * at link time and in the browser fails outright with "does not provide an export named 'default'".
 *
 * Top-level await, so the public accessor stays synchronous: this module resolves its dependency
 * once, at import time, and everything after it is ordinary synchronous code. That matters here more
 * than it does for the engine — `tileEnabled` is read on the render path, where there is nothing to
 * await into.
 */

/** One normalized group, as `normGroups` emits it. Sparse by design: `title` is absent when empty
 *  and `hideTitle` only ever stores `true` (see the module's own "Groups" comment block). */
export interface DashBlocksGroup {
  id: string;
  tileIds: string[];
  bg: string;
  title?: string;
  hideTitle?: true;
}

export interface DashBlocksModule {
  /** The code-rendered blocks of the dashboard page, in render order. */
  FUNCTIONAL_BLOCK_IDS: string[];
  /** The single source of the widget-instance id pattern — never re-type the literal. */
  WIDGET_INSTANCE_RE: RegExp;
  /** Is `id` a key `display.enabled` may carry at all? A functional block, or a `w_` instance. */
  isEnabledKey(id: unknown): boolean;
  /** Absent ≡ ON. Only an explicit `false` hides a tile. */
  tileEnabled(display: unknown, id: string): boolean;
  /** The single-entry patch a switch sends: OFF stores `false`, ON deletes the key (`null` is the
   *  deletion marker), so a default-on tile never accumulates a redundant `true`. Throws on an id
   *  outside the domain — a caller bug, refused before a request can claim the switch was saved. */
  enabledPatch(id: string, on: boolean): Record<string, false | null>;
  GROUP_ID_RE: RegExp;
  /** The closed tint palette for a group frame. Full-surface tints — never a left-edge stripe. */
  GROUP_TINTS: string[];
  /** `GROUP_TINTS` plus `'none'`: a frame that draws no mat and no border. */
  GROUP_BGS: string[];
  GROUP_LIMITS: { groups: number; tiles: number; title: number };
  normGroups(
    groups: unknown
  ): { ok: true; out: DashBlocksGroup[] } | { ok: false; detail: string };
  /** Members not in `liveIds` drop; a group with none left dissolves. The same rule dash-gate runs
   *  server-side, so the two sides cannot disagree about which members survive a delete. */
  sweepGroups(groups: unknown, liveIds: string[]): DashBlocksGroup[];
}

declare global {
  // eslint-disable-next-line no-var
  var DashBlocks: DashBlocksModule | undefined;
}

/** The `default` a vendor module exposes under CJS interop, and `undefined` in a browser. */
async function umdDefault<T>(load: Promise<{ default?: unknown }>): Promise<T | undefined> {
  return (await load).default as T | undefined;
}

const DashBlocksImport = await umdDefault<DashBlocksModule>(import("./dash-blocks.js"));

function required<T>(fromGlobal: T | undefined, fromImport: T | undefined, name: string): T {
  const value = fromGlobal ?? fromImport;
  if (value === undefined) {
    throw new Error(
      `[pacing-dashboard/vendor] ${name} did not load from vendor/${name}.js - failed to load or was edited (forbidden, see vendor/SOURCE.md).`
    );
  }
  return value;
}

/** The vendored `dash-blocks` module — the id grammar, the `display.enabled` rule and the group
 *  rules, as Pacing itself runs them. */
export function getDashBlocks(): DashBlocksModule {
  return required(globalThis.DashBlocks, DashBlocksImport, "dash-blocks");
}
