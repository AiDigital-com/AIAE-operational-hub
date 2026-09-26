package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;

import java.util.List;

/**
 * Shape of the {@code POST /api/internal/users/sync} request body.
 *
 * @param users the employees to sync
 */
record UsersSyncRequest(List<PacingUserSyncEntry> users) {
}
