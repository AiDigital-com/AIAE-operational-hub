package com.aidigital.operationalhub.service.pacingdrift.model;

import java.util.List;

/**
 * Outcome of a US-106 drift comparison between the Hub roster and Pacing's user mirror (§2 of the
 * migration plan).
 *
 * @param rows every disagreement found, in no guaranteed order
 */
public record PacingDriftReport(List<PacingDriftRow> rows) {
}
