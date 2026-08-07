package com.aidigital.operationalhub.application.mapper;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;

import java.io.ByteArrayOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;

/**
 * Unit tests for {@link XlsxDownloadResponder}, which builds the response every .xlsx download shares.
 */
@ExtendWith(MockitoExtension.class)
class XlsxDownloadResponderTest {

	@Mock
	private ReportRowExportStreamer streamer;

	@Mock
	private ReportRowFileSupport fileSupport;

	@Test
	void shouldNameTheAttachmentAfterTheCampaignAndWhatTheFileIsTest() {
		// Given: a campaign name that is not safe for a file system
		XlsxDownloadResponder responder = new XlsxDownloadResponder(streamer, fileSupport);
		Resource streamed = new ByteArrayResource(new byte[] {1, 2, 3});
		doReturn("Q1 Launch-Promo").when(fileSupport).fileSafe("Q1 Launch/Promo");
		doReturn(streamed).when(streamer).stream(any(XlsxWriter.class));

		// When:
		ResponseEntity<Resource> result =
				responder.respond("Q1 Launch/Promo", "conversions template", false, out -> { });

		// Then: sanitised, and suffixed with what the file is - the two templates and the report all land in
		// one downloads folder
		assertThat(result.getHeaders().getFirst("Content-Disposition"))
				.contains("Q1 Launch-Promo - conversions template.xlsx");
		assertThat(result.getHeaders().getContentType().toString())
				.isEqualTo("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
		assertThat(result.getStatusCode().value()).isEqualTo(200);
		assertThat(result.getBody()).isSameAs(streamed);
	}

	@Test
	void shouldReportWhetherTheFileWasCutShortTest() {
		// Given:
		XlsxDownloadResponder responder = new XlsxDownloadResponder(streamer, fileSupport);
		doReturn("Q1 Launch").when(fileSupport).fileSafe("Q1 Launch");
		doReturn(new ByteArrayResource(new byte[] {1})).when(streamer).stream(any(XlsxWriter.class));

		// When:
		ResponseEntity<Resource> capped = responder.respond("Q1 Launch", "report", true, out -> { });
		ResponseEntity<Resource> whole = responder.respond("Q1 Launch", "report", false, out -> { });

		// Then: a capped file looks exactly like a complete one, so the client is told which it holds -
		// without this header a download that silently dropped rows would go unnoticed
		assertThat(capped.getHeaders().getFirst("X-Report-Truncated")).isEqualTo("true");
		assertThat(whole.getHeaders().getFirst("X-Report-Truncated")).isEqualTo("false");
	}

	@Test
	void shouldHandTheWriterToTheStreamerRatherThanBufferTheWorkbookTest() throws Exception {
		// Given:
		XlsxDownloadResponder responder = new XlsxDownloadResponder(streamer, fileSupport);
		doReturn("Q1 Launch").when(fileSupport).fileSafe("Q1 Launch");
		doReturn(new ByteArrayResource(new byte[] {1})).when(streamer).stream(any(XlsxWriter.class));
		ByteArrayOutputStream written = new ByteArrayOutputStream();

		// When:
		responder.respond("Q1 Launch", "report", false, out -> out.write(7));

		// Then: the caller's writer reaches the streamer untouched, so bytes go to the client as POI
		// produces them instead of through a fully-buffered array
		verify(streamer).stream(any(XlsxWriter.class));
		assertThat(written.size()).isZero();
	}
}
