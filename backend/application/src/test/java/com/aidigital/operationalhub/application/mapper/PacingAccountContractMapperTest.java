package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAccountV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNotifyDestinationV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAccount;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Account Settings ("Daily Summary"). The mapper renames only - Pacing owns which values are
 * valid - so what is worth pinning is that every value Pacing can actually store round-trips onto
 * the contract's enum unchanged.
 */
class PacingAccountContractMapperTest {

	private final PacingAccountContractMapper mapper = new PacingAccountContractMapper();

	@ParameterizedTest
	@CsvSource({"auto,AUTO", "dm,DM", "off,OFF"})
	void shouldMapEachStoredValueToItsContractEnumTest(String stored, String expected) {
		// When:
		PacingAccountV1 result = mapper.toV1(new PacingAccount(stored, "", null));

		// Then:
		assertThat(result.getNotifyDestination()).isEqualTo(PacingNotifyDestinationV1.valueOf(expected));
	}

	@Test
	void shouldRejectAValuePacingWouldNeverActuallyStoreTest() {
		// Given: Pacing validates before writing, so this state should never arrive here - a mapper
		// that silently accepted it would hide a bug in Pacing's own validation instead of surfacing it.
		assertThatThrownBy(() -> mapper.toV1(new PacingAccount("carrier-pigeon", "", null)))
				.isInstanceOf(IllegalArgumentException.class);
	}

	@Test
	void shouldCarryTheSlackChannelIdAndWarningThroughUnchangedTest() {
		// When:
		PacingAccountV1 result = mapper.toV1(new PacingAccount("auto", "G0123456789", "Slack could not be reached"));

		// Then:
		assertThat(result.getSlackChannelId()).isEqualTo("G0123456789");
		assertThat(result.getSlackWarning()).isEqualTo("Slack could not be reached");
	}
}
