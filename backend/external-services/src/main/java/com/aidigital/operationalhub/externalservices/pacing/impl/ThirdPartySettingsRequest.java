package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * Shape of the third-party-only {@code POST /api/dashboards/:slug/settings} request body - carries
 * {@code third_party} only, never {@code display}, {@code data} or {@code line_items}, so choosing
 * CM360 campaigns can never touch the widget configuration or the plan.
 *
 * <p>The entries stay maps. Pacing validates them (its own {@code safeThirdParty}: the type
 * discriminator, the campaign and report caps, the audit stamps it adds itself), and a second
 * opinion here would only be a copy to keep in step.
 *
 * @param thirdParty the whole {@code third_party} list to store; a WHOLE-ARRAY replace, so a caller
 *                   offering a picker must send every entry it does not own, not only the ones it
 *                   changed
 */
record ThirdPartySettingsRequest(@JsonProperty("third_party") List<Map<String, Object>> thirdParty) {
}
