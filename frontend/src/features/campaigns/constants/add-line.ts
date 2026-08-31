import type { AddLineLevel } from "../model/add-line";
import type { ConstructedEntityLevelEnumV1 } from "../types";

/** How long an added row's typed name waits before it is resolved against the campaign's mart data. */
export const ADD_LINE_RESOLVE_DEBOUNCE_MS = 300;

/** How many matches to fetch for one resolved name - bounds the disambiguation popover's own list. */
export const ADD_LINE_RESOLVE_PAGE_SIZE = 50;

/** Report-row dimension ids the three constructed-name levels correspond to, in level order. */
export const ADD_LINE_LEVELS: AddLineLevel[] = ["LVL1", "LVL2", "LVL3"];

/** Maps a constructed-name level to the dimension id its (still free-text) name field owns. */
export const ADD_LINE_LEVEL_NAME_DIM_ID: Record<AddLineLevel, string> = {
  LVL1: "line_item_name",
  LVL2: "insertion_order_name",
  LVL3: "campaign_constructed_name",
};

/** Maps a constructed-name level to the dimension id its (never-typed) id field owns. */
export const ADD_LINE_LEVEL_ID_DIM_ID: Record<AddLineLevel, string> = {
  LVL1: "line_item_id",
  LVL2: "insertion_order_id",
  LVL3: "campaign_constructed_id",
};

/** Maps a constructed-name level to the generated OpenAPI level enum the resolve endpoint takes. */
export const ADD_LINE_LEVEL_ENUM: Record<AddLineLevel, ConstructedEntityLevelEnumV1> = {
  LVL1: "LVL1",
  LVL2: "LVL2",
  LVL3: "LVL3",
};

/**
 * The three constructed-id dimension ids - an added row never lets these be typed (PDI_117 D1): they are
 * either resolved from the typed name or generated server-side, and always rendered read-only.
 */
export const ADD_LINE_ID_DIM_IDS: string[] = Object.values(ADD_LINE_LEVEL_ID_DIM_ID);

/**
 * Dimension ids an added row never offers as an input (PDI_116): `adjusted_metrics` is a marker
 * derived from the metrics that were actually filled, and the four audit stamps are written by the
 * server on save. A typed value in any of them is dropped, so offering the box is a lie.
 *
 * `adjusted_metrics` is doubly not an input: the adjustments view does not read the written marker back
 * at all, and stamps every manually added line with the literal `Non-existent data` instead - which is
 * what this column reads once the row is saved, and is the view's behaviour, not a Hub bug.
 */
export const ADD_LINE_SERVER_OWNED_DIM_IDS: string[] = [
  "adjusted_metrics",
  "created_at",
  "created_by",
  "last_modified_at",
  "last_modified_by",
];
