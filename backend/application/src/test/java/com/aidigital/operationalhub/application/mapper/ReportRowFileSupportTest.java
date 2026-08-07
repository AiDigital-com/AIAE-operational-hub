package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link ReportRowFileSupport}.
 */
class ReportRowFileSupportTest {

	private final ReportRowFileSupport support = new ReportRowFileSupport();

	@Test
	void shouldReplaceFilesystemUnsafeCharactersWithAHyphenTest() {
		// Execution + Verification:
		assertThat(support.fileSafe("Q1 Launch/Promo: \"Auto\" <2026>")).isEqualTo("Q1 Launch-Promo- -Auto- -2026-");
	}

	@Test
	void shouldLeaveAPlainNameUnchangedTest() {
		// Execution + Verification:
		assertThat(support.fileSafe("Ourisman Ford 2026")).isEqualTo("Ourisman Ford 2026");
	}

	@Test
	void shouldReadAnUploadedFilesBytesTest() {
		// Given:
		MockMultipartFile file = new MockMultipartFile(
				"file", "edits.xlsx", "application/octet-stream", "hello".getBytes(StandardCharsets.UTF_8));

		// Execution:
		byte[] bytes = support.readBytes(file);

		// Verification:
		assertThat(bytes).isEqualTo("hello".getBytes(StandardCharsets.UTF_8));
	}

	@Test
	void shouldThrowOph027WhenTheFileCannotBeReadTest() throws IOException {
		// Given:
		MultipartFile file = mock(MultipartFile.class);
		when(file.getBytes()).thenThrow(new IOException("boom"));

		// When/Then:
		assertThatThrownBy(() -> support.readBytes(file))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
	}
}
