package com.aidigital.operationalhub.service.agency.model;

/**
 * One level's resolved constructed id, as previewed to the user before Add Line mode B is saved (PDI_117
 * D3). The save path re-derives the same value server-side regardless of what the client sends.
 *
 * @param value  the constructed id
 * @param origin whether the id belongs to an existing mart entity or was freshly generated
 */
public record ResolvedConstructedId(String value, ConstructedIdOrigin origin) {

}
