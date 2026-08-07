package com.aidigital.operationalhub.application.mapper;

import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

/**
 * Builds the HTTP response for an .xlsx download: the content type, the attachment file name, and the
 * header that says whether the file is complete.
 *
 * <p>One place because the three downloads - the report, the delivery template, the conversions template -
 * had the same four lines each, and one of them is easy to get wrong quietly. Omit the truncation header and
 * a capped file looks exactly like a complete one; the client reads the header to decide whether to warn,
 * and a download that silently drops rows is the kind of thing nobody notices until a number is wrong.
 */
@Component
@RequiredArgsConstructor
public class XlsxDownloadResponder {

	private static final String XLSX_CONTENT_TYPE =
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

	/**
	 * The response header carrying whether the row cap was hit. Read by the frontend, which warns the user
	 * that the file they just downloaded is incomplete.
	 */
	private static final String TRUNCATED_HEADER = "X-Report-Truncated";

	private final ReportRowExportStreamer streamer;

	private final ReportRowFileSupport fileSupport;

	/**
	 * Streams a workbook as an attachment named after the campaign.
	 *
	 * @param campaignName the campaign's name, sanitised into the file name
	 * @param fileSuffix   what the file is, appended after the campaign name (e.g. {@code "report"})
	 * @param truncated    whether the row cap was hit, reported to the client
	 * @param writer       writes the workbook into the response stream
     * @return the download response
	 */
	public ResponseEntity<Resource> respond(
			String campaignName, String fileSuffix, boolean truncated, XlsxWriter writer) {
		Resource xlsx = streamer.stream(writer);
		String fileName = fileSupport.fileSafe(campaignName) + " - " + fileSuffix + ".xlsx";
		return ResponseEntity.ok()
				.contentType(MediaType.parseMediaType(XLSX_CONTENT_TYPE))
				.header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
				.header(TRUNCATED_HEADER, String.valueOf(truncated))
				.body(xlsx);
	}
}
