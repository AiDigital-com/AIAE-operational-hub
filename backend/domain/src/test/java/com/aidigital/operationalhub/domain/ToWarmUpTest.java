package com.aidigital.operationalhub.domain;

import com.aidigital.operationalhub.domain.entity.HubRole;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ToWarmUpTest {

	@Test
	void shouldFailWhenRepositoryDoesNotOverrideEntityClassTest() {
		// Given:
		ToWarmUp<HubRole> repository = List::of;

		// When:
		ThrowingCallable actualCall = repository::getClazz;

		// Then:
		assertThatThrownBy(actualCall)
				.isInstanceOf(IllegalArgumentException.class)
				.hasMessage("getClazz() must be overridden by the warm-up repository.");
	}
}
