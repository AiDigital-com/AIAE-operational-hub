package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.Map;

/**
 * Shape of the parts of Pacing's settings-save success response the Hub reads.
 *
 * @param display the saved display, echoed back by Pacing
 */
record DisplaySettingsResponse(Map<String, Object> display) {
}
