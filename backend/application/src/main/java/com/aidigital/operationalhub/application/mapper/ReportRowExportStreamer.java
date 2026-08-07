package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.config.properties.ReportExportProperties;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.io.UncheckedIOException;
import java.util.concurrent.Semaphore;

/**
 * Streams an .xlsx workbook to the HTTP response without ever holding the whole rendered file in
 * memory: {@link #stream(XlsxWriter)} runs the given writer on a background thread against one end of a
 * pipe and hands the other end back as a {@link Resource}, so Spring's message converter copies bytes to
 * the client as POI produces them instead of waiting for a fully-buffered {@code byte[]}.
 *
 * <p>Bounded by a fixed permit pool ({@link ReportExportProperties#getMaxConcurrentExports()}) so a burst
 * of large concurrent exports cannot pile up POI workbooks (and their writer threads) without limit; a
 * request beyond the limit is rejected immediately rather than queued.
 */
@Slf4j
@Component
public class ReportRowExportStreamer {

	private static final int PIPE_BUFFER_BYTES = 64 * 1024;

	private final Semaphore concurrentExports;

	/**
	 * Constructs the streamer with a fixed concurrent-export permit pool sized from configuration.
	 *
	 * @param properties the export concurrency configuration
	 */
	public ReportRowExportStreamer(ReportExportProperties properties) {
		this.concurrentExports = new Semaphore(properties.getMaxConcurrentExports());
	}

	/**
	 * Starts streaming a workbook produced by {@code writer}, returning immediately with a {@link
	 * Resource} whose bytes become available as the background writer produces them.
	 *
	 * @param writer produces the workbook, given the output stream to write it into
	 * @return a streamed resource wrapping the workbook bytes
	 * @throws BusinessException OPH_032 when the concurrent-export limit is already reached
	 */
	public Resource stream(XlsxWriter writer) {
		if (!concurrentExports.tryAcquire()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_032);
		}
		try {
			PipedOutputStream pipedOut = new PipedOutputStream();
			PipedInputStream pipedIn = new PipedInputStream(pipedOut, PIPE_BUFFER_BYTES);
			Thread.ofVirtual().name("report-export-writer").start(() -> runWriter(writer, pipedOut));
			return new InputStreamResource(pipedIn);
		} catch (IOException e) {
			concurrentExports.release();
			throw new UncheckedIOException("Failed to open the export pipe", e);
		}
	}

	/**
	 * Runs the workbook writer against the piped stream, always releasing the concurrency permit and
	 * closing the pipe afterward regardless of outcome. The permit is released before the pipe is
	 * closed, so it becomes available to a later export as soon as this writer's own work is done,
	 * without waiting for the response reader to finish draining whatever is still buffered. Runs on a
	 * background thread started by {@link #stream(XlsxWriter)}, so a write failure here can only be
	 * logged — the response's headers (and possibly some of its body) may already be committed by the
	 * time it occurs.
	 *
	 * @param writer   produces the workbook
	 * @param pipedOut the piped stream the writer writes into and {@link #stream(XlsxWriter)}'s
	 *                 returned resource drains from
	 */
	void runWriter(XlsxWriter writer, PipedOutputStream pipedOut) {
		try {
			writer.write(pipedOut);
		} catch (IOException e) {
			log.warn("Streaming export failed mid-write", e);
		} finally {
			concurrentExports.release();
			closeQuietly(pipedOut);
		}
	}

	/**
	 * Closes the piped stream, logging rather than throwing when the close itself fails — the writer's
	 * own work is already finished (successfully or not) by the time this runs.
	 *
	 * @param pipedOut the stream to close
	 */
	void closeQuietly(PipedOutputStream pipedOut) {
		try {
			pipedOut.close();
		} catch (IOException e) {
			log.warn("Failed to close the export pipe", e);
		}
	}
}
