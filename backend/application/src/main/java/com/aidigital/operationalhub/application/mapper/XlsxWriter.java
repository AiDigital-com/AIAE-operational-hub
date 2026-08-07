package com.aidigital.operationalhub.application.mapper;

import java.io.IOException;
import java.io.OutputStream;

/**
 * Produces one .xlsx workbook by writing it into a given output stream — the streaming counterpart to
 * an assembler's {@code byte[] toWorkbook(...)} convenience method, used by
 * {@link ReportRowExportStreamer} to pipe workbook bytes straight to the HTTP response instead of
 * buffering them in memory first.
 */
@FunctionalInterface
public interface XlsxWriter {

	/**
	 * Writes the workbook into the given stream. Does not close {@code out}; the caller owns its
	 * lifecycle.
	 *
	 * @param out the stream to write the workbook into
	 * @throws IOException when the underlying stream write fails
	 */
	void write(OutputStream out) throws IOException;
}
