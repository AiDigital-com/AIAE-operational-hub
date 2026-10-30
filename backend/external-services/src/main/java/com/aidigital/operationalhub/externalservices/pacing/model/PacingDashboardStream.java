package com.aidigital.operationalhub.externalservices.pacing.model;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;

/**
 * One open answer of Pacing's {@code GET /api/dashboards/:slug/data}, handed over UNREAD: the status,
 * the headers the Hub copies to the browser, and the body as a stream still attached to the upstream
 * connection (DASHBOARD-DATA-PASSTHROUGH-PLAN, 2026-10-29).
 *
 * <p>Deliberately not a parsed object. That body is 30-132 MB on the biggest pacings, and the three
 * copies the old client kept of it at once - the response buffer, the Jackson tree, the reshaped
 * contract - are what took the Hub's pods down. Here the Hub holds an 8 KB copy buffer and nothing
 * else: the bytes go from Pacing's socket to the browser's as they are, compressed if Pacing
 * compressed them.
 *
 * <p>The caller OWNS the connection: it must {@link #close()} (or hand {@link #body()} to something
 * that closes it, which is what the controller's {@code InputStreamResource} does once Spring has
 * copied it). A 304 carries no body and nothing to release.
 *
 * @param status          200 (a body follows) or 304 (nothing changed since the browser's ETag)
 * @param etag            Pacing's strong ETag - the md5 of the uncompressed body; null if absent
 * @param contentType     the body's content type as Pacing sent it; null on a 304
 * @param contentEncoding {@code gzip} when Pacing compressed the body for a caller that accepted it;
 *                        null when the body is plain, and on a 304
 * @param contentLength   the body's length on the wire, in bytes; null when Pacing did not say
 * @param cacheControl    Pacing's {@code Cache-Control} ({@code private, no-cache}); null if absent
 * @param vary            Pacing's {@code Vary} ({@code Accept-Encoding}); null if absent
 * @param body            the body, streaming from the upstream connection, whose {@code close()}
 *                        releases that connection; null on a 304
 */
public record PacingDashboardStream(
		int status,
		String etag,
		String contentType,
		String contentEncoding,
		Long contentLength,
		String cacheControl,
		String vary,
		InputStream body) implements Closeable {

	/**
	 * Whether Pacing answered 304 - the browser's copy is current and there is no body.
	 *
	 * @return true on a 304
	 */
	public boolean notModified() {
		return status == 304;
	}

	/**
	 * Releases the upstream connection. Safe to call on a 304, which holds none.
	 *
	 * @throws IOException if closing the body fails
	 */
	@Override
	public void close() throws IOException {
		if (body != null) {
			body.close();
		}
	}
}
