import type { ConstructedEntityV1 } from "../types";

/**
 * Which constructed-name level an id cell resolves/generates for. PDI_117 D2: resolution is per level,
 * not per row - one row may legitimately end up with real ids at some levels and generated ones at
 * others (an existing insertion order and line item with a brand-new creative is the common case).
 */
export type AddLineLevel = "LVL1" | "LVL2" | "LVL3";

/**
 * Whether a resolved name matches more than one mart entity (PDI_117-PLAN.md 2.1:
 * `constructed_name -> constructed_id` is one-to-many) - when true, the id cell must open the
 * disambiguation popover instead of filling silently.
 *
 * @param entities every entity a name resolution matched
 * @returns whether more than one distinct id shares that name
 */
export function isAmbiguousMatch(entities: ConstructedEntityV1[]): boolean {
  return new Set(entities.map((entity) => entity.id)).size > 1;
}
