package com.aidigital.operationalhub.service.pacingdrift.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftCategory;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftRow;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pure unit tests for {@link PacingDriftDiffer} - no Spring context, no network, matching the plan's
 * three US-106 categories plus the active-mismatch this implementation also flags.
 */
class PacingDriftDifferTest {

	private final PacingDriftDiffer differ = new PacingDriftDiffer();

	@Test
	void shouldReportNoRowsWhenBothSidesFullyAgreeTest() {
		// Given:
		HubUser hubUser = hubUser("same@x.com", "Same Person", HubStatus.ACTIVE.getCode());
		PacingUserMirrorEntry pacingUser = new PacingUserMirrorEntry("same@x.com", "Same Person", true);

		// When:
		List<PacingDriftRow> rows = differ.diff(List.of(hubUser), List.of(pacingUser));

		// Then:
		assertThat(rows).isEmpty();
	}

	@Test
	void shouldFlagAHubEmployeeMissingFromPacingTest() {
		// Given: the sync will create this row the next time it runs - this is what catches it before then
		HubUser hubUser = hubUser("new@x.com", "New Hire", HubStatus.ACTIVE.getCode());

		// When:
		List<PacingDriftRow> rows = differ.diff(List.of(hubUser), List.of());

		// Then:
		assertThat(rows).containsExactly(
				new PacingDriftRow("new@x.com", PacingDriftCategory.MISSING_IN_PACING, "New Hire", null, true, null));
	}

	@Test
	void shouldFlagAPacingUserMissingFromTheHubTest() {
		// Given: reproduces the real bug this report exists to catch - alice@aidigital.com and
		// NEWBIE@AiDigital.com exist in Pacing but not in the Hub, and the sync (which only ever visits
		// emails IT sends) can never notice that on its own.
		PacingUserMirrorEntry alice = new PacingUserMirrorEntry("alice@aidigital.com", "Alice", true);
		PacingUserMirrorEntry newbie = new PacingUserMirrorEntry("NEWBIE@AiDigital.com", "Newbie", true);

		// When:
		List<PacingDriftRow> rows = differ.diff(List.of(), List.of(alice, newbie));

		// Then:
		assertThat(rows).containsExactlyInAnyOrder(
				new PacingDriftRow("alice@aidigital.com", PacingDriftCategory.MISSING_IN_HUB, null, "Alice", null, true),
				new PacingDriftRow("NEWBIE@AiDigital.com", PacingDriftCategory.MISSING_IN_HUB, null, "Newbie", null, true));
	}

	@Test
	void shouldFlagANameMismatchWithBothSystemsValuesTest() {
		// Given:
		HubUser hubUser = hubUser("drift@x.com", "Correct Name", HubStatus.ACTIVE.getCode());
		PacingUserMirrorEntry pacingUser = new PacingUserMirrorEntry("drift@x.com", "Stale Name", true);

		// When:
		List<PacingDriftRow> rows = differ.diff(List.of(hubUser), List.of(pacingUser));

		// Then: the row states which system holds which value
		assertThat(rows).containsExactly(new PacingDriftRow(
				"drift@x.com", PacingDriftCategory.NAME_MISMATCH, "Correct Name", "Stale Name", true, true));
	}

	@Test
	void shouldFlagAnActiveMismatchWithBothSystemsValuesTest() {
		// Given: the Hub thinks this employee left, but Pacing still has them active
		HubUser hubUser = hubUser("left@x.com", "Left Employee", HubStatus.INACTIVE.getCode());
		PacingUserMirrorEntry pacingUser = new PacingUserMirrorEntry("left@x.com", "Left Employee", true);

		// When:
		List<PacingDriftRow> rows = differ.diff(List.of(hubUser), List.of(pacingUser));

		// Then:
		assertThat(rows).containsExactly(new PacingDriftRow(
				"left@x.com", PacingDriftCategory.ACTIVE_MISMATCH, "Left Employee", "Left Employee", false, true));
	}

	@Test
	void shouldFlagBothANameMismatchAndAnActiveMismatchAsTwoSeparateRowsTest() {
		// Given: one email can carry two distinct disagreements - each gets its own row rather than being
		// folded into a single "something is different" row.
		HubUser hubUser = hubUser("both@x.com", "Hub Name", HubStatus.ACTIVE.getCode());
		PacingUserMirrorEntry pacingUser = new PacingUserMirrorEntry("both@x.com", "Pacing Name", false);

		// When:
		List<PacingDriftRow> rows = differ.diff(List.of(hubUser), List.of(pacingUser));

		// Then:
		assertThat(rows).hasSize(2);
		assertThat(rows).extracting(PacingDriftRow::category)
				.containsExactlyInAnyOrder(PacingDriftCategory.NAME_MISMATCH, PacingDriftCategory.ACTIVE_MISMATCH);
	}

	@Test
	void shouldMatchEmailsCaseInsensitivelyTest() {
		// Given: both sides enforce case-insensitive uniqueness on email at the database layer
		HubUser hubUser = hubUser("Mixed.Case@x.com", "Mixed Case", HubStatus.ACTIVE.getCode());
		PacingUserMirrorEntry pacingUser = new PacingUserMirrorEntry("mixed.case@x.com", "Mixed Case", true);

		// When:
		List<PacingDriftRow> rows = differ.diff(List.of(hubUser), List.of(pacingUser));

		// Then:
		assertThat(rows).isEmpty();
	}

	@Test
	void shouldSkipAHubUserWithNoEmailTest() {
		// Given: nothing to match it against - not a drift finding, just an unusable row
		HubUser noEmail = hubUser(null, "No Email", HubStatus.ACTIVE.getCode());

		// When:
		List<PacingDriftRow> rows = differ.diff(List.of(noEmail), List.of());

		// Then:
		assertThat(rows).isEmpty();
	}

	private static HubUser hubUser(String email, String displayName, String status) {
		HubUser user = new HubUser();
		user.setEmail(email);
		user.setDisplayName(displayName);
		user.setStatus(status);
		return user;
	}
}
