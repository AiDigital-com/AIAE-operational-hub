package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.Map;

/**
 * What a save says about the Google Sheet that replaces delivery.
 *
 * <p>A wrapper, because the field has THREE states and a bare map carries two. No instruction at all
 * means "leave the stored source alone"; an instruction carrying an entry replaces it; an
 * instruction carrying null DISCONNECTS it, which is what a person does by removing the source.
 * Pacing itself reads the three apart by whether the key is present and whether its value is null.
 *
 * @param entry the source to store, or null to disconnect the stored one
 */
public record PacingSheetSourceInstruction(Map<String, Object> entry) {
}
