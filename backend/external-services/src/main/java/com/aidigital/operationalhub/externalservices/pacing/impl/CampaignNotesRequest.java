package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * Shape of the notes-only {@code POST /api/dashboards/:slug/settings} request body - carries
 * {@code campaign_notes_rich} only, so a notes save can never touch the display, the plan, the
 * links or any other stored namespace. Pacing validates the document, stores it and derives the
 * plain-text {@code campaign_notes} from it ({@code dash-gate/lib/db.mjs}); the client never writes
 * the plain text itself.
 *
 * @param notesRich the TipTap document, serialized under the snake_case wire key
 *                  {@code campaign_notes_rich} Pacing stores
 */
record CampaignNotesRequest(@JsonProperty("campaign_notes_rich") Map<String, Object> notesRich) {
}
