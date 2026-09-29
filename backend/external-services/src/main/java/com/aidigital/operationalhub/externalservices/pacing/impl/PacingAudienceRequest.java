package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingAudienceEntry;

import java.util.List;

/**
 * Shape of the {@code POST /api/internal/pacing-audience} request body.
 *
 * @param audiences the per-pacing audience lists to push
 */
record PacingAudienceRequest(List<PacingAudienceEntry> audiences) {
}
