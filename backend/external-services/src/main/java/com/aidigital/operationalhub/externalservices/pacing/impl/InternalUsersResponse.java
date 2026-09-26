package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;

import java.util.List;

/**
 * Shape of Pacing's {@code GET /api/internal/users} response body.
 *
 * @param users every row of Pacing's user mirror
 */
record InternalUsersResponse(List<PacingUserMirrorEntry> users) {
}
