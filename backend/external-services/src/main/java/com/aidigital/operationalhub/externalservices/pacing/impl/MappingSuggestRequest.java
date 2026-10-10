package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * The body of a mapping suggestion request, in the shape Pacing's route reads.
 *
 * <p>A null {@code mappingId} is OMITTED rather than sent: Pacing treats an absent key as "the
 * first dimensions-kind entity", and an explicit null would be a different statement.
 *
 * @param mappingId the entity whose existing dimensions must not be duplicated, or null for the
 *                  pacing's first dimensions-kind entity
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record MappingSuggestRequest(@JsonProperty("mapping_id") String mappingId) {
}
