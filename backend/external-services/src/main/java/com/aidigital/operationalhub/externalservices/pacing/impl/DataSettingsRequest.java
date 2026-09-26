package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the data-only {@code POST /api/dashboards/:slug/settings} request body - carries
 * {@code data} only, never {@code display} or {@code line_items}, so a settings save can never
 * accidentally touch the widget configuration or the plan.
 *
 * @param data the data namespace to merge into the stored one
 */
record DataSettingsRequest(DataNamespaceRequest data) {
}
