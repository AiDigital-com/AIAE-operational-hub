/**
 * Client-side mirrors of the campaign-links contract caps (`PacingCampaignLinkV1` /
 * `PacingCampaignLinksUpdateV1` in the OpenAPI spec, enforced server-side by the Hub's
 * `CampaignLinksValidator`). Mirrored so a paste that would 400 is named in the drawer before the
 * request is ever sent - the backend stays the authority, this is just the earlier of the two
 * copies of the same numbers.
 */
export const MAX_LINKS = 50;
export const MAX_LINK_NAME_LENGTH = 120;
export const MAX_LINK_URL_LENGTH = 2048;
