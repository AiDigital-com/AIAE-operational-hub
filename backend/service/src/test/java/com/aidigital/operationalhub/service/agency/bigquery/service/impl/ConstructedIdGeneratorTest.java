package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.exception.AppException;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link ConstructedIdGenerator} - PDI_117 D3's deterministic, namespaced constructed ids,
 * scoped so a bare level-2/level-3 name (measured to be reused across advertisers) cannot collide across
 * different clients.
 */
class ConstructedIdGeneratorTest {

	private final ConstructedIdGenerator generator = new ConstructedIdGenerator();

	@Test
	void shouldGenerateTheSameIdForTheSameComponentsTest() {
		// Given:
		List<String> components = List.of("TrueM_Andy's Frozen Custard_19_2026");

		// When:
		String first = generator.generate(components);
		String second = generator.generate(components);

		// Then:
		assertThat(first).isEqualTo(second);
	}

	@Test
	void shouldGenerateDifferentIdsForDifferentComponentsTest() {
		// When:
		String first = generator.generate(List.of("Line A"));
		String second = generator.generate(List.of("Line B"));

		// Then:
		assertThat(first).isNotEqualTo(second);
	}

	@Test
	void shouldPrefixEveryGeneratedIdWithOphTest() {
		// When:
		String id = generator.generate(List.of("Any Line Name"));

		// Then:
		assertThat(id).startsWith("OPH_");
		assertThat(id).hasSize("OPH_".length() + 16);
	}

	@Test
	void shouldRejectAnEmptyComponentListTest() {
		// When/Then:
		assertThatThrownBy(() -> generator.generate(List.of()))
				.isInstanceOf(AppException.class);
	}

	@Test
	void shouldRejectABlankComponentTest() {
		// When/Then:
		assertThatThrownBy(() -> generator.generate(List.of("valid", "   ")))
				.isInstanceOf(AppException.class);
	}

	@Test
	void shouldRejectANullComponentListTest() {
		// When/Then:
		assertThatThrownBy(() -> generator.generate(null))
				.isInstanceOf(AppException.class);
	}

	@Test
	void shouldGiveDifferentClientsSharingALevel2NameDifferentIdsTest() {
		// Given: two different clients' campaigns whose level-2 name happens to be the same free-form
		// string (measured: 509 of 24 077 level-2 names are shared across clients - PDI_117-PLAN.md D3)
		String scopeClientA = "AgencyA_ClientA_FIN_Q1Launch";
		String scopeClientB = "AgencyB_ClientB_RET_Q1Launch";
		String sharedLevel2Name = "Insertion Order";

		// When:
		String idClientA = generator.generate(List.of(scopeClientA, sharedLevel2Name));
		String idClientB = generator.generate(List.of(scopeClientB, sharedLevel2Name));

		// Then:
		assertThat(idClientA).isNotEqualTo(idClientB);
	}

	@Test
	void shouldGiveDifferentClientsSharingALevel3NameDifferentIdsTest() {
		// Given: two different clients whose level-3 (creative) name happens to be identical
		String scopeClientA = "AgencyA_ClientA_FIN_Q1Launch";
		String scopeClientB = "AgencyB_ClientB_RET_Q1Launch";
		String sharedLevel3Name = "300x250 banner";

		// When:
		String idClientA = generator.generate(List.of(scopeClientA, sharedLevel3Name));
		String idClientB = generator.generate(List.of(scopeClientB, sharedLevel3Name));

		// Then:
		assertThat(idClientA).isNotEqualTo(idClientB);
	}

	@Test
	void shouldGiveTheSameInsertionOrderTheSameIdRegardlessOfWhichLineItemAddedItFirstTest() {
		// Given: one campaign's stable scope, reached via two different level-1 (line item) names - the
		// naive "mix in the sibling line item's own name" fix would break this
		String campaignScope = generator.scopeOf("AGY_CL_FIN_Q1_ChannelA_TacticA_-*-1-*-*-*-_-*-");
		String sameInsertionOrderName = "Q1 Insertion Order";

		// When: the same insertion order reached from two different line items in the same campaign
		String idFromLineItemA = generator.generate(List.of(campaignScope, sameInsertionOrderName));
		String idFromLineItemB = generator.generate(List.of(campaignScope, sameInsertionOrderName));

		// Then:
		assertThat(idFromLineItemA).isEqualTo(idFromLineItemB);
	}

	@Test
	void shouldNotChangeLevel1IdsWithThisCorrectionTest() {
		// Given: level 1 is always hashed from its own name alone, never scoped
		String name = "AGY_CL_FIN_Q1_ChannelA_TacticA_-*-1-*-*-*-_-*-";

		// When:
		String id = generator.generate(List.of(name));

		// Then: matches the unscoped, single-component hash - unaffected by the scope correction
		assertThat(id).isEqualTo(generator.generate(List.of(name)));
		assertThat(id).startsWith("OPH_");
	}

	@Test
	void shouldHashAComponentListDifferentlyFromItsNaiveConcatenationTest() {
		// Given: two component lists whose parts concatenate to the same string - proving the
		// length-prefixed encoding, not delimiter-joined concatenation, is actually in use
		List<String> firstSplit = List.of("ab", "c");
		List<String> secondSplit = List.of("a", "bc");

		// When:
		String firstId = generator.generate(firstSplit);
		String secondId = generator.generate(secondSplit);

		// Then:
		assertThat(firstId).isNotEqualTo(secondId);
	}

	@Test
	void shouldDeriveTheScopeFromTheLeadingFourSegmentsOfTheLevelOneNameTest() {
		// When:
		String scope = generator.scopeOf("Agency_Client_IND_Campaign_Channel_Tactic_-*-1-*-*-*-_-*-");

		// Then:
		assertThat(scope).isEqualTo("Agency_Client_IND_Campaign");
	}

	@Test
	void shouldToleratesFewerThanFourSegmentsWhenDerivingScopeTest() {
		// Given: a level-1 name still being typed, with fewer than four segments so far - the preview
		// endpoint may call scopeOf before the full sixteen-segment name is complete
		// When:
		String scope = generator.scopeOf("Agency_Client");

		// Then:
		assertThat(scope).isEqualTo("Agency_Client");
	}

	@Test
	void shouldRejectDerivingScopeFromABlankNameTest() {
		// When/Then:
		assertThatThrownBy(() -> generator.scopeOf("   "))
				.isInstanceOf(AppException.class);
	}
}
