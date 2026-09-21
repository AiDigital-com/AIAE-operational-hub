import type { components } from "../../shared/api/generated/schema";

export type { PacingRowV1 } from "../pacing-overview/types";

/**
 * Discriminated outcome of the "refresh all dashboards" trigger (admin only, not in the migration
 * plan): a 429 inside Pacing's own cooldown is a normal outcome to render as a countdown, never an
 * error to throw - the same shape as pacing-dashboard's single-pacing `PacingRefreshOutcome`.
 */
export type RefreshAllOutcome =
  | { status: "started" }
  | { status: "cooldown"; retryAfterSeconds: number };

export type PacingRetryAfterV1 = components["schemas"]["PacingRetryAfterV1"];
export type PacingRevalidateResultV1 = components["schemas"]["PacingRevalidateResultV1"];
