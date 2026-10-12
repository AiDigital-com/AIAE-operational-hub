package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the data-only {@code POST /api/dashboards/:slug/settings} request body - carries
 * {@code data} only, never {@code display} or {@code line_items}, so a settings save can never
 * accidentally touch the widget configuration or the plan.
 *
 * <p>The namespace is a MAP rather than a record: Pacing gates each of its keys on
 * {@code hasOwnProperty}, so "absent" and "present and null" are two different instructions
 * there, and a record that drops its nulls can only ever send the first. See
 * {@link DataNamespaceWire}.
 *
 * @param data the data namespace to merge into the stored one
 */
record DataSettingsRequest(java.util.Map<String, Object> data) {
}
