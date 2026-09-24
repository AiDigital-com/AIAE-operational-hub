package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegation;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegationGrant;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * §12. The mapper renames and parses; it decides nothing. What is worth pinning is the one thing it
 * DOES answer - which side of a grant the caller is on - and the two ways a date can arrive.
 */
class PacingDelegationContractMapperTest {

	private final PacingDelegationContractMapper mapper = new PacingDelegationContractMapper();

	private PacingDelegation delegation(String delegatorEmail) {
		return new PacingDelegation("d1", "u1", "Lead", delegatorEmail, "u2", "Me", "me@aidigital.com",
				"2026-09-01T00:00:00.000Z", "2026-09-20T23:59:59.000Z", "Leave", null, null, null, 7);
	}

	@Test
	void shouldCallAGrantIGaveGrantedTest() {
		// Given: the delegator is the caller. Matched on email because a delegation is keyed on PACING
		// user ids and the Hub's session carries none - email is the identifier both sides agree on.
		PacingDelegationV1 result = mapper.toV1(delegation("me@aidigital.com"), "ME@aidigital.com");

		// Then: case-insensitive - neither system promises a casing
		assertThat(result.getDirection()).isEqualTo(PacingDelegationV1.DirectionEnum.GRANTED);
	}

	@Test
	void shouldCallAGrantSomebodyElseGaveReceivedTest() {
		// Given:
		PacingDelegationV1 result = mapper.toV1(delegation("lead@aidigital.com"), "me@aidigital.com");

		// Then:
		assertThat(result.getDirection()).isEqualTo(PacingDelegationV1.DirectionEnum.RECEIVED);
	}

	@Test
	void shouldFallBackToReceivedWhenTheDelegatorCannotBeIdentifiedTest() {
		// Given: no email on either side. Of the two ways to be wrong, only one of them can act: a
		// grant wrongly filed as mine offers a Revoke button for access I never gave.
		PacingDelegationV1 result = mapper.toV1(delegation(null), null);

		// Then:
		assertThat(result.getDirection()).isEqualTo(PacingDelegationV1.DirectionEnum.RECEIVED);
	}

	@Test
	void shouldNotLoseAWholeListToOneUnparseableDateTest() {
		// Given: a timestamp shape the parser does not know. The delegation's recipient, scope and
		// revoke button are all intact - throwing would have taken every OTHER delegation off screen
		// with it.
		PacingDelegation odd = new PacingDelegation("d1", "u1", "Lead", "lead@x.com", "u2", "Me", "me@x.com",
				"not-a-date", "2026-09-20", null, null, null, null, 0);

		// When:
		PacingDelegationV1 result = mapper.toV1(odd, "me@x.com");

		// Then: the unreadable one is null, the date-only one still parses
		assertThat(result.getStartsAt()).isNull();
		assertThat(result.getExpiresAt()).isEqualTo(LocalDate.of(2026, 9, 20).atStartOfDay());
	}

	@Test
	void shouldPassAnEmptyPacingListThroughAsEverythingOwnedTest() {
		// Given: no pacings named - which is the portfolio-wide grant of US-134, a much larger promise
		// than a scoped one and therefore not something to infer by accident.
		PacingDelegationGrant grant = mapper.toGrant(
				new PacingDelegationCreateV1().delegateId("u2").expiresAt(LocalDate.of(2026, 9, 20)));

		// Then:
		assertThat(grant.pacingIds()).isEmpty();
		assertThat(grant.expiresAt()).isEqualTo("2026-09-20");
		assertThat(grant.startsAt()).isNull();
	}

	@Test
	void shouldCarryNamedPacingsVerbatimTest() {
		// Given:
		PacingDelegationGrant grant = mapper.toGrant(new PacingDelegationCreateV1()
				.delegateId("u2").expiresAt(LocalDate.of(2026, 9, 20)).pacingIds(List.of("p1", "p2")));

		// Then:
		assertThat(grant.pacingIds()).containsExactly("p1", "p2");
	}
}
