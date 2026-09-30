import type { PacingScopeV1 } from "./types";

/**
 * Why a pacing list is empty, resolved from the scope the Hub asserted rather than guessed from the
 * absence of rows (US-111). A `campaigns` scope with no ids is the expected shape for a Client
 * Services user today — the Hub does not yet resolve which NetSuite campaigns they own — so that
 * case reads as "not wired up yet", not as a broken page.
 *
 * Used by the owner-grouped Overview at `/` — its own module (not an export of the
 * retired PacingOverview screen) so it survived that screen’s removal with the Overview still using it.
 */
export function emptyScopeCopy(scope: PacingScopeV1 | undefined): { title: string; body: string } {
  if (!scope) {
    return { title: "No pacings", body: "There are no pacings visible to your account yet." };
  }
  if (scope.kind === "campaigns") {
    if (scope.ids.length === 0) {
      return {
        title: "Campaign ownership isn't resolved yet",
        body: "The Hub doesn't yet resolve which NetSuite campaigns you own, so there is nothing to show here — this isn't a bug. Ask an admin if you expect to see campaigns.",
      };
    }
    return {
      title: "No pacings for your campaigns",
      body: "None of the campaigns assigned to you have a pacing set up in Pacing yet.",
    };
  }
  if (scope.kind === "owners") {
    if (scope.ids.length === 0) {
      return {
        title: "Nobody in scope yet",
        body: "You have no pacings of your own, and no direct or indirect reports with any either.",
      };
    }
    return {
      title: "No pacings yet",
      body: "No pacing has been created for you or your team yet.",
    };
  }
  return { title: "No pacings yet", body: "There are no pacings in Pacing yet." };
}
