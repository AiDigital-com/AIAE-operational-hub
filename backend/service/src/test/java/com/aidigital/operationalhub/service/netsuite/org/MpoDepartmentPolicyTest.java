package com.aidigital.operationalhub.service.netsuite.org;

import com.aidigital.operationalhub.service.netsuite.config.NetSuiteSyncProperties;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link MpoDepartmentPolicy}: the one answer to "is this Rippling department inside MPO", shared by
 * the Director gate and by campaign sharing.
 */
class MpoDepartmentPolicyTest {

	private static final String MPO_ROOT = "Media & Performance Optimization";

	@Test
	void shouldAcceptTheRootAndEverySubDepartmentUnderItTest() {
		// Given: the default root, and paths at every depth with untidy whitespace and case
		MpoDepartmentPolicy policy = new MpoDepartmentPolicy(new NetSuiteSyncProperties());

		// When / Then:
		assertThat(policy.isMpo(MPO_ROOT)).isTrue();
		assertThat(policy.isMpo(MPO_ROOT + " > Media Optimization")).isTrue();
		assertThat(policy.isMpo("media &  performance optimization > Integration > Engineering")).isTrue();
		assertThat(policy.isMpo("Growth")).isFalse();
		assertThat(policy.isMpo("Client Services > " + MPO_ROOT)).isFalse();
	}

	@Test
	void shouldFailClosedWhenRootDepartmentIsBlankOrMissingTest() {
		// Given: a policy configured with a blank root, and a person with no department at all
		NetSuiteSyncProperties blankRoot = new NetSuiteSyncProperties();
		blankRoot.setDirectorRootDepartment("  ");
		MpoDepartmentPolicy blankRootPolicy = new MpoDepartmentPolicy(blankRoot);

		// When:
		boolean blankConfiguration = blankRootPolicy.isMpo(MPO_ROOT + " > Media Optimization");
		boolean blankDepartment = new MpoDepartmentPolicy(new NetSuiteSyncProperties()).isMpo(null);

		// Then: neither side of the comparison being blank ever counts as MPO
		assertThat(blankConfiguration).isFalse();
		assertThat(blankDepartment).isFalse();
	}
}
