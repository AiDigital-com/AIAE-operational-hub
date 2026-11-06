import type { PacingRowV1 } from "../pacing-overview/types";

/**
 * The Overview's owner filter: My pacings · My team · All pacings. A view over the list the user is
 * already entitled to - it narrows, never widens, and access itself is still decided by the Hub's
 * RBAC scope on the request.
 */
export type OwnerScope = "mine" | "team" | "all";

export interface OwnerScopeOption {
  key: OwnerScope;
  label: string;
  /** What the option keeps, shown under the filter bar while it is selected. */
  hint: string;
}

export const OWNER_SCOPES: OwnerScopeOption[] = [
  { key: "mine", label: "My pacings", hint: "Pacings you own in Ops Hub, plus pacings delegated to you" },
  { key: "team", label: "My team", hint: "Pacings owned by people in your team, plus pacings delegated to you" },
  { key: "all", label: "All pacings", hint: "Every pacing you have access to" },
];

/** First visit, no saved choice: the same for everyone, no role logic (owner decision). */
export const DEFAULT_OWNER_SCOPE: OwnerScope = "all";

/** Who is looking: the two things the filter compares a row's owner against. */
export interface OwnerScopeViewer {
  /** The viewer's own Pacing user id (`UserV1.pacingUserId`), absent before the user sync reached them. */
  pacingUserId?: string | null;
  /** The viewer's team as Pacing user ids (`PacingListResponseV1.teamOwnerIds`), the viewer included. */
  teamOwnerIds?: readonly string[];
}

/**
 * Reads an owner scope out of a query-string value, accepting only an option the filter offers.
 *
 * @param raw the `scope` value from the URL
 * @returns the scope, or null when it is not one
 */
export function parseOwnerScope(raw: string | null | undefined): OwnerScope | null {
  return OWNER_SCOPES.some((option) => option.key === raw) ? (raw as OwnerScope) : null;
}

function storageKey(userId: string): string {
  return `overview-owner-scope:${userId}`;
}

/**
 * The choice this user last made on this browser. Kept per user so whoever signs in next at the same
 * desk does not inherit it.
 *
 * @param userId the signed-in user id, or undefined before the profile is in cache
 * @returns the saved scope, or null when there is none to read
 */
export function readSavedOwnerScope(userId: string | undefined): OwnerScope | null {
  if (!userId) return null;
  try {
    return parseOwnerScope(localStorage.getItem(storageKey(userId)));
  } catch {
    // A blocked store costs the memory, not the page.
    return null;
  }
}

/**
 * Remembers the user's choice for every later visit, until they pick another option.
 *
 * @param userId the signed-in user id; nothing is saved without one
 * @param scope  the chosen scope
 */
export function saveOwnerScope(userId: string | undefined, scope: OwnerScope): void {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), scope);
  } catch {
    // Private-mode or quota failures cost the convenience, not the page.
  }
}

/**
 * Whether a row stays in the selected view. A row delegated to the viewer counts as theirs in both
 * narrow views - it is work they are covering, and it would otherwise only be findable in All.
 *
 * @param row    the pacing row
 * @param scope  the selected owner scope
 * @param viewer who is looking
 */
export function inOwnerScope(row: PacingRowV1, scope: OwnerScope, viewer: OwnerScopeViewer): boolean {
  if (scope === "all") return true;
  if (row.delegatedFrom) return true;
  if (!row.ownerId) return false;
  if (row.ownerId === viewer.pacingUserId) return true;
  return scope === "team" && (viewer.teamOwnerIds ?? []).includes(row.ownerId);
}

/**
 * The next wider option, offered when the selected one comes up empty.
 *
 * @param scope the selected scope
 * @returns the wider scope, or null for All, which has nothing wider
 */
export function widerOwnerScope(scope: OwnerScope): OwnerScope | null {
  if (scope === "mine") return "team";
  if (scope === "team") return "all";
  return null;
}

/**
 * The option's display label.
 *
 * @param scope the scope
 */
export function ownerScopeLabel(scope: OwnerScope): string {
  return OWNER_SCOPES.find((option) => option.key === scope)?.label ?? scope;
}
