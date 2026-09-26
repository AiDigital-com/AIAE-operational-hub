package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.List;

/**
 * Shape of the plan-only {@code POST /api/dashboards/:slug/settings} request body (§9,
 * US-125/126/127) - carries {@code line_items} only, never {@code display}, so a plan save can
 * never accidentally touch the widget/layout configuration §6's display save owns.
 *
 * @param line_items the whole line-item set to persist
 */
record PlanSettingsRequest(List<LineItemPlanUpdateRequest> line_items) {
}
