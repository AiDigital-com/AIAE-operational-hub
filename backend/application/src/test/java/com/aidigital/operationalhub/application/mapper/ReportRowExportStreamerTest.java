package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.config.properties.ReportExportProperties;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;

import java.io.IOException;
import java.io.PipedOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link ReportRowExportStreamer}.
 */
class ReportRowExportStreamerTest {

	private ReportExportProperties properties(int maxConcurrentExports) {
		ReportExportProperties properties = new ReportExportProperties();
		properties.setMaxConcurrentExports(maxConcurrentExports);
		return properties;
	}

	@Test
	void shouldStreamTheWriterBytesThroughTheReturnedResourceTest() throws IOException {
		// Given:
		ReportRowExportStreamer streamer = new ReportRowExportStreamer(properties(2));
		byte[] payload = "hello export".getBytes(StandardCharsets.UTF_8);

		// When:
		Resource resource = streamer.stream(out -> out.write(payload));

		// Then:
		assertThat(resource.getInputStream().readAllBytes()).isEqualTo(payload);
	}

	@Test
	void shouldReleaseThePermitAfterStreamingSoALaterExportCanAcquireItTest() throws IOException {
		// Given: a single-permit streamer whose first export is fully drained (and so released)
		ReportRowExportStreamer streamer = new ReportRowExportStreamer(properties(1));
		byte[] first = "first".getBytes(StandardCharsets.UTF_8);
		streamer.stream(out -> out.write(first)).getInputStream().readAllBytes();

		// When:
		byte[] second = "second".getBytes(StandardCharsets.UTF_8);
		Resource resource = streamer.stream(out -> out.write(second));

		// Then:
		assertThat(resource.getInputStream().readAllBytes()).isEqualTo(second);
	}

	@Test
	void shouldReleaseThePermitWhenTheWriterFailsSoALaterExportCanStillAcquireItTest() throws IOException {
		// Given: a single-permit streamer whose writer fails mid-write
		ReportRowExportStreamer streamer = new ReportRowExportStreamer(properties(1));
		Resource failed = streamer.stream(out -> {
			throw new IOException("boom");
		});
		failed.getInputStream().readAllBytes();

		// When: a second export starts once the permit has been released
		byte[] second = "second".getBytes(StandardCharsets.UTF_8);
		Resource resource = streamer.stream(out -> out.write(second));

		// Then:
		assertThat(resource.getInputStream().readAllBytes()).isEqualTo(second);
	}

	@Test
	void shouldRejectWithOph032WhenTheConcurrentExportLimitIsAlreadyReachedTest() throws IOException {
		// Given: the only permit is held by an export whose writer is still blocked mid-write
		ReportRowExportStreamer streamer = new ReportRowExportStreamer(properties(1));
		CountDownLatch releaseWriter = new CountDownLatch(1);
		Resource blocked = streamer.stream(out -> awaitUninterruptibly(releaseWriter));

		// When-Then:
		assertThatThrownBy(() -> streamer.stream(out -> { }))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_032.getCode());

		// Cleanup: unblock the first writer so its background thread completes rather than leaking
		// past the test.
		releaseWriter.countDown();
		blocked.getInputStream().readAllBytes();
	}

	@Test
	void shouldLogRatherThanThrowWhenClosingThePipeFailsTest() {
		// Given: a piped stream whose close() always fails
		ReportRowExportStreamer streamer = new ReportRowExportStreamer(properties(1));
		PipedOutputStream failsToClose = new PipedOutputStream() {
			@Override
			public void close() throws IOException {
				throw new IOException("boom");
			}
		};

		// When-Then: the failure is swallowed rather than propagated
		streamer.closeQuietly(failsToClose);
	}

	private void awaitUninterruptibly(CountDownLatch latch) {
		try {
			latch.await(2, TimeUnit.SECONDS);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}
}
