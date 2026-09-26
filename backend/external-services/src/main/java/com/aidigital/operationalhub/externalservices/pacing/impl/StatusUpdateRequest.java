package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the {@code PATCH /api/pacings/:id/status} request body (§9, US-128).
 *
 * @param status {@code Live}, {@code Paused}, {@code Complete} or {@code Archive}
 */
record StatusUpdateRequest(String status) {
}
