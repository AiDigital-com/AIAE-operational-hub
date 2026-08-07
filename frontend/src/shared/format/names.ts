/** Shown in place of a campaign whose NetSuite name is missing — mirrors "Client without name". */
export const CAMPAIGN_WITHOUT_NAME = "Campaign without name";

/**
 * A campaign's display name: its real NetSuite name, or a neutral placeholder when that name is
 * missing. BigQuery yields both an empty string and the literal string "null" for an absent name, so
 * both count as missing rather than surfacing as a blank or a stray "null" in the UI.
 *
 * @param name the campaign's raw name
 * @return the name to display
 */
export function campaignDisplayName(name?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return CAMPAIGN_WITHOUT_NAME;
  return trimmed;
}
