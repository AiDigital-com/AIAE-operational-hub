package com.aidigital.operationalhub.service.agency.model;

import java.util.List;

/**
 * The conversions rows behind a template download, plus whether the read hit its row cap.
 *
 * <p>The flag exists so the truncation cannot be silent. A short template looks exactly like a complete
 * one, and someone who edits and re-uploads it has no way to notice that the rows past the cap were never
 * offered - the same reason the delivery export carries the flag too.
 *
 * @param rows         the conversions rows, capped
 * @param truncated    whether rows beyond the cap were dropped
 * @param campaignName the resolved campaign's name, for building a human-readable download filename
 *                     without a second campaign lookup - the same reason
 *                     {@link ReportRowExportModel} carries it
 */
public record ConversionRowExportModel(
		List<ConversionRowModel> rows, boolean truncated, String campaignName) {
}
