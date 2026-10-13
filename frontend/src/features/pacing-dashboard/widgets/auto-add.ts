/**
 * The one-shot auto-add — the reference's `applyAutoAdd` (`dashboardStore.js`), the only place this
 * app originates `display.autoAdded`.
 *
 * Standard's rate-type rules (`autoAddKeys`) say which widgets a pacing should carry: the click charts
 * on a CPC pacing, the view charts on a CPV one, the VCR chart where there is a video target, and —
 * since the sections cutover — «Delivery vs CM360» wherever a 3rd-party source is configured. They
 * run once at creation (dash-gate's `widget-seed.mjs`) and once more here, when a rate type first
 * APPEARS on an existing pacing or a CM360 source is first configured. The keys they produced are
 * remembered in `display.autoAdded`, so after that the set is the user's and a deletion sticks.
 */
import { autoAddKeys, SEED_ID_BY_KEY, stdEntry } from "../spa/std-catalog.js";
import { libraryInstance } from "../spa/widget-ops.js";
import type { PacingDisplayShape, PacingWidgetInstance } from "../types";

type LiPlan = Record<string, { ch?: unknown }>;
type LiDaily = Record<string, Record<string, { co?: number }>>;

/** Does any non-audio line carry completed views? `null` when the facts are not there to ask:
 *  unknown, not false — the rules then skip the VCR chart rather than deciding against it. */
export function hasVideoCompletesInFacts(
  facts: { liDaily?: LiDaily } | null | undefined,
  liPlan: LiPlan | null | undefined
): boolean | null {
  const LD = facts?.liDaily;
  if (!LD || !liPlan) return null;
  return Object.entries(liPlan).some(([id, p]) => String(p?.ch ?? "").toLowerCase() !== "audio"
    && Object.values(LD[id] ?? {}).some((v) => (Number(v?.co) || 0) > 0));
}

export interface AutoAddPlan {
  /** Keys the rules want that the pacing has no receipt for — all of them get one. */
  fresh: string[];
  /** The canonical instances minted for them, under their fixed ids. */
  added: PacingWidgetInstance[];
  /** Fixed ids that carry an OFF switch left by the tile that used to hold them. */
  staleOff: string[];
}

/**
 * What the auto-add would write, or `null` when there is nothing new. Pure: the page saves it.
 *
 * A key whose fixed id is already held is DONE — the user added «Delivery vs CM360» from the
 * Standard shelf before configuring the source — so it gets its receipt and nothing is minted.
 */
export function planAutoAdd(
  display: PacingDisplayShape,
  // The seam's own fields (spa/store.js `usePacingState`), typed there by inference from moved JS.
  liPlanIn: unknown,
  factsIn: unknown,
  thirdPartyIn: unknown
): AutoAddPlan | null {
  const liPlan = (liPlanIn ?? null) as LiPlan | null;
  const facts = (factsIn ?? null) as { liDaily?: LiDaily } | null;
  const thirdParty = Array.isArray(thirdPartyIn) ? thirdPartyIn : [];
  const stored = (display as { autoAdded?: unknown }).autoAdded;
  const known = new Set(Array.isArray(stored) ? stored : []);
  const wanted: string[] = autoAddKeys(
    // `autoAddKeys` accepts both field spellings (rate_type / rateType, channel / ch), which is what
    // lets the normalized plans stand in for the stored config here.
    { line_items: Object.values(liPlan ?? {}), third_party: thirdParty },
    { hasVideoCompletes: hasVideoCompletesInFacts(facts, liPlan) }
  );
  const fresh = wanted.filter((key) => !known.has(key));
  if (!fresh.length) return null;

  const ids = (display.widgets ?? []).map((w) => w.id);
  const added: PacingWidgetInstance[] = [];
  const staleOff: string[] = [];
  for (const key of fresh) {
    const fixed: string | undefined = (SEED_ID_BY_KEY as Record<string, string>)[key];
    if (fixed && ids.includes(fixed)) continue;
    const widget = libraryInstance(stdEntry(key), ids, fixed) as PacingWidgetInstance;
    ids.push(widget.id);   // several may be minted at once; each must see the previous one
    added.push(widget);
    // dash-gate sweeps `enabled` only on a save whose `widgets` no longer name the id, so a delete
    // and a re-mint that never cross one leave the switch behind - and the tile is born invisible.
    if (fixed && display.enabled?.[fixed] === false) staleOff.push(fixed);
  }
  return { fresh, added, staleOff };
}
