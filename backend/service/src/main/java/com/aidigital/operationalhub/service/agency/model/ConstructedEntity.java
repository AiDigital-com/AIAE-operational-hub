package com.aidigital.operationalhub.service.agency.model;

/**
 * One constructed-name-level entity read from the campaign's own mart data (PDI_117 Add Line mode A
 * cascading picker). {@code firstDate}/{@code lastDate}/{@code impressions} are the discriminators a
 * disambiguation popover shows when one name carries several distinct ids - see
 * PDI_117-PLAN.md 2.1: {@code constructed_name -> constructed_id} is one-to-many, not a function.
 *
 * @param name        the entity's constructed name at this level
 * @param id          the entity's constructed id at this level
 * @param firstDate   earliest delivery date (ISO) this entity was seen on
 * @param lastDate    latest delivery date (ISO) this entity was seen on
 * @param impressions summed delivered impressions for this entity, or {@code null}
 */
public record ConstructedEntity(String name, String id, String firstDate, String lastDate, Long impressions) {

}
