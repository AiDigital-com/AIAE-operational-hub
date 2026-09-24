package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingNotifySettings;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Shape of the notify-only {@code POST /api/dashboards/:slug/settings} request body (§14 of the
 * migration plan): the whole {@code notify} namespace, wrapped exactly as Pacing's
 * {@code saveSettings} expects a top-level config key.
 *
 * <p>A top-level type rather than a record nested in {@link PacingClientImpl} - unlike this file's
 * older siblings there ({@code DataSettingsRequest} and friends), which predate the "no nested data
 * types in production code" rule this module now follows.
 *
 * @param notifySettings the whole alert configuration to persist, serialized under the wire key
 *                       {@code notify} - a record component literally named {@code notify} is
 *                       illegal (its accessor would override the final {@code Object.notify()})
 */
record NotifySettingsRequest(@JsonProperty("notify") PacingNotifySettings notifySettings) {
}
