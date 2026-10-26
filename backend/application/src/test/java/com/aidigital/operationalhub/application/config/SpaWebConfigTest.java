package com.aidigital.operationalhub.application.config;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryKindV1;
import org.junit.jupiter.api.Test;
import org.springframework.format.support.DefaultFormattingConversionService;

import static org.assertj.core.api.Assertions.assertThat;

class SpaWebConfigTest {

	@Test
	void shouldConvertLibraryKindFromItsWireValueTest() {
		// Given: the frontend sends the contract's lowercase value, `?kind=layout`
		DefaultFormattingConversionService conversionService = new DefaultFormattingConversionService();
		new SpaWebConfig(null).addFormatters(conversionService);

		// When:
		PacingLibraryKindV1 layout = conversionService.convert("layout", PacingLibraryKindV1.class);
		PacingLibraryKindV1 widget = conversionService.convert("WIDGET", PacingLibraryKindV1.class);

		// Then:
		assertThat(layout).isEqualTo(PacingLibraryKindV1.LAYOUT);
		assertThat(widget).isEqualTo(PacingLibraryKindV1.WIDGET);
	}
}
