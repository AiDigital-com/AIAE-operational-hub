package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingDataSettings;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The {@code data} object of a settings save, in the snake_case keys Pacing stores.
 *
 * <p>Its own class because it is the one place in this client where "absent" and "present and null"
 * are different instructions, and that rule is easier to keep right where it is the whole subject of
 * the file.
 */
final class DataNamespaceWire {

	private DataNamespaceWire() {
	}

	/**
	 * Renames the settings to the snake_case keys Pacing's {@code config.data} namespace stores.
	 *
	 * @param settings the settings to write; null fields stay null and are dropped on serialization
	 * @return the wire shape of the {@code data} object
	 */
	static Map<String, Object> of(PacingDataSettings settings) {
		// A MAP, not a record with NON_NULL. Pacing gates every key on `hasOwnProperty`, so "absent"
		// and "present and null" are two different instructions there - and a record that drops its
		// nulls can only ever send the first. That is fine for the flags, which have no null meaning,
		// and wrong for `sheet`, where null is how a person disconnects the source.
		Map<String, Object> out = new LinkedHashMap<>();
		if (settings.source() != null) {
			out.put("source", settings.source());
		}
		if (settings.fetchCreatives() != null) {
			out.put("fetch_creatives", settings.fetchCreatives());
		}
		if (settings.fetchConversions() != null) {
			out.put("fetch_conversions", settings.fetchConversions());
		}
		if (settings.coefEnabled() != null) {
			out.put("coef_enabled", settings.coefEnabled());
		}
		if (settings.netEnabled() != null) {
			out.put("net_enabled", settings.netEnabled());
		}
		if (settings.primaryCvEnabled() != null) {
			out.put("primary_cv_enabled", settings.primaryCvEnabled());
		}
		if (settings.deliveryTab() != null) {
			out.put("delivery_tab", settings.deliveryTab());
		}
		if (settings.dimSources() != null) {
			out.put("dim_sources", settings.dimSources());
		}
		if (settings.valueLabels() != null) {
			out.put("value_labels", settings.valueLabels());
		}
		// The three-state one: no instruction leaves the key out, an instruction puts it in - carrying
		// its entry, or null to disconnect.
		if (settings.sheet() != null) {
			out.put("sheet", settings.sheet().entry());
		}
		return out;
	}
}
