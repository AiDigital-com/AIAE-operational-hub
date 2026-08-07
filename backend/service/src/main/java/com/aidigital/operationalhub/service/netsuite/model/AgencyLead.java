package com.aidigital.operationalhub.service.netsuite.model;

/**
 * A single agency together with its MPO team lead, read from the IO Lines BigQuery source. The lead
 * name resolves (via the synced employees) to the team the agency belongs to.
 *
 * @param agencyId    the IO Lines agency id
 * @param mpoTeamLead the agency's MPO team lead name, or {@code null} when absent
 */
public record AgencyLead(Long agencyId, String mpoTeamLead) {

}
