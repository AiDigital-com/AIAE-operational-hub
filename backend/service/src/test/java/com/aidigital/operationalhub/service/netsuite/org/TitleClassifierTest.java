package com.aidigital.operationalhub.service.netsuite.org;

import com.aidigital.operationalhub.domain.enums.Grade;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link TitleClassifier}.
 */
class TitleClassifierTest {

	private final TitleClassifier classifier = new TitleClassifier();

	@Test
	void shouldClassifySeniorDirectorTest() {
		// Given:
		String title = "Senior Director, Media Optimization  ";

		// When:
		TitleClassification result = classifier.classify(title);

		// Then:
		assertThat(result.orgRole()).isEqualTo(OrgRole.DIRECTOR);
		assertThat(result.grade()).isEqualTo(Grade.SENIOR_DIRECTOR);
		assertThat(result.titleUnrecognized()).isFalse();
	}

	@Test
	void shouldClassifyDirectorTest() {
		// Given:
		String title = "Media Optimization Director";

		// When:
		TitleClassification result = classifier.classify(title);

		// Then:
		assertThat(result.orgRole()).isEqualTo(OrgRole.DIRECTOR);
		assertThat(result.grade()).isEqualTo(Grade.DIRECTOR);
		assertThat(result.titleUnrecognized()).isFalse();
	}

	@Test
	void shouldClassifyTeamLeadTest() {
		// Given:
		String title = "Team Lead, Media Optimization";

		// When:
		TitleClassification result = classifier.classify(title);

		// Then:
		assertThat(result.orgRole()).isEqualTo(OrgRole.TEAM_LEAD);
		assertThat(result.grade()).isEqualTo(Grade.TEAM_LEAD);
		assertThat(result.titleUnrecognized()).isFalse();
	}

	@Test
	void shouldClassifyTraineeTest() {
		// Given:
		String title = "Media Optimization Trainee";

		// When:
		TitleClassification result = classifier.classify(title);

		// Then:
		assertThat(result.orgRole()).isEqualTo(OrgRole.MEMBER);
		assertThat(result.grade()).isEqualTo(Grade.TRAINEE);
		assertThat(result.titleUnrecognized()).isFalse();
	}

	@Test
	void shouldClassifySeniorManagerTest() {
		// Given:
		String title = "Senior Media Optimization Manager";

		// When:
		TitleClassification result = classifier.classify(title);

		// Then:
		assertThat(result.orgRole()).isEqualTo(OrgRole.MEMBER);
		assertThat(result.grade()).isEqualTo(Grade.SENIOR);
		assertThat(result.titleUnrecognized()).isFalse();
	}

	@Test
	void shouldClassifyJuniorManagerTest() {
		// Given:
		String title = "Junior Media Optimization Manager";

		// When:
		TitleClassification result = classifier.classify(title);

		// Then:
		assertThat(result.orgRole()).isEqualTo(OrgRole.MEMBER);
		assertThat(result.grade()).isEqualTo(Grade.JUNIOR);
		assertThat(result.titleUnrecognized()).isFalse();
	}

	@Test
	void shouldClassifyPlainManagerAsMiddleTest() {
		// Given:
		String title = "Media Optimization Manager";

		// When:
		TitleClassification result = classifier.classify(title);

		// Then:
		assertThat(result.orgRole()).isEqualTo(OrgRole.MEMBER);
		assertThat(result.grade()).isEqualTo(Grade.MIDDLE);
		assertThat(result.titleUnrecognized()).isFalse();
	}

	@Test
	void shouldFlagUnrecognizedTitleTest() {
		// Given:
		String title = "Chief Vibes Officer";

		// When:
		TitleClassification result = classifier.classify(title);

		// Then:
		assertThat(result.orgRole()).isEqualTo(OrgRole.MEMBER);
		assertThat(result.grade()).isEqualTo(Grade.UNKNOWN);
		assertThat(result.titleUnrecognized()).isTrue();
	}

	@Test
	void shouldFlagNullTitleAsUnrecognizedTest() {
		// Given:
		String title = null;

		// When:
		TitleClassification result = classifier.classify(title);

		// Then:
		assertThat(result.orgRole()).isEqualTo(OrgRole.MEMBER);
		assertThat(result.grade()).isEqualTo(Grade.UNKNOWN);
		assertThat(result.titleUnrecognized()).isTrue();
	}
}
