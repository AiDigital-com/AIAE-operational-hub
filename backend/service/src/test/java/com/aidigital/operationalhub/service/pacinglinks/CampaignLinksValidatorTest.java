package com.aidigital.operationalhub.service.pacinglinks;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignLink;
import com.aidigital.operationalhub.service.exception.BusinessException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link CampaignLinksValidator} (§16 of the migration plan, US-140/141) - the one
 * gate between a pasted URL and a link the Hub renders clickable.
 */
class CampaignLinksValidatorTest {

	private final CampaignLinksValidator validator = new CampaignLinksValidator();

	@Test
	void shouldAcceptATypicalMixedListTest() {
		// Given: presets, a DSP console and a custom doc - the §16 happy path
		List<PacingCampaignLink> links = List.of(
				new PacingCampaignLink("Asana", "https://app.asana.com/0/1201234567890/list"),
				new PacingCampaignLink("IO", "https://drive.google.com/file/d/abc/view"),
				new PacingCampaignLink("DV360", "http://displayvideo.google.com/ng_nav/p/1"),
				new PacingCampaignLink("Contract scan", "https://example.com/contract.pdf"));

		// When-Then:
		assertThatCode(() -> validator.validate(links)).doesNotThrowAnyException();
	}

	@Test
	void shouldAcceptAnEmptyListTest() {
		// Given: removing the last link is a legitimate save - the whole array is replaced, so an
		// empty list is how "delete them all" travels.
		// When-Then:
		assertThatCode(() -> validator.validate(List.of())).doesNotThrowAnyException();
	}

	@ParameterizedTest
	@ValueSource(strings = {
			"javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"ftp://files.example.com/plan.xlsx",
			"just some words",
			"http://",
			""
	})
	void shouldRejectAnythingButAbsoluteHttpUrlsTest(String url) {
		// Given: the Hub renders these clickable, so a non-http(s) URL stored today is a script
		// click tomorrow - the load-bearing check of the whole validator
		List<PacingCampaignLink> links = List.of(new PacingCampaignLink("Media Plan", url));

		// When-Then:
		assertThatThrownBy(() -> validator.validate(links))
				.isInstanceOf(BusinessException.class)
				.hasMessage("Campaign link 'Media Plan': the URL must be a full http:// or https:// address.");
	}

	@Test
	void shouldRejectABlankNameAndSayWhichEntryTest() {
		// Given: entry #2 has a whitespace-only name - the message must point at it by position,
		// because a nameless link has nothing else to be named by
		List<PacingCampaignLink> links = List.of(
				new PacingCampaignLink("Asana", "https://app.asana.com/0/123/456"),
				new PacingCampaignLink("   ", "https://example.com/doc"));

		// When-Then:
		assertThatThrownBy(() -> validator.validate(links))
				.isInstanceOf(BusinessException.class)
				.hasMessage("Campaign link 2 needs a name.");
	}

	@Test
	void shouldRejectAnOverLongNameTest() {
		// Given: one character over the contract's 120 cap
		String name = "x".repeat(121);
		List<PacingCampaignLink> links = List.of(new PacingCampaignLink(name, "https://example.com"));

		// When-Then:
		assertThatThrownBy(() -> validator.validate(links))
				.isInstanceOf(BusinessException.class)
				.hasMessage("Campaign link '" + name + "': the name is too long (at most 120 characters).");
	}

	@Test
	void shouldRejectAnOverLongUrlTest() {
		// Given: one character over the contract's 2048 cap
		String url = "https://example.com/" + "a".repeat(2048);
		List<PacingCampaignLink> links = List.of(new PacingCampaignLink("IO", url));

		// When-Then:
		assertThatThrownBy(() -> validator.validate(links))
				.isInstanceOf(BusinessException.class)
				.hasMessage("Campaign link 'IO': the URL is too long (at most 2048 characters).");
	}

	@Test
	void shouldRejectMoreThanFiftyLinksTest() {
		// Given: 51 well-formed links - Pacing stores the array verbatim with no cap of its own,
		// so the Hub is the only place this is bounded
		List<PacingCampaignLink> links = new ArrayList<>();
		for (int i = 0; i < 51; i++) {
			links.add(new PacingCampaignLink("Doc " + i, "https://example.com/" + i));
		}

		// When-Then:
		assertThatThrownBy(() -> validator.validate(links))
				.isInstanceOf(BusinessException.class)
				.hasMessage("A pacing can keep at most 50 campaign links.");
	}

	@ParameterizedTest
	@ValueSource(strings = {
			"https://example.com/asana",
			"https://app.asana.com/",
			"https://app.asana.com",
			"https://notasana.com/0/123/456"
	})
	void shouldRejectAnAsanaSlotThatIsNotAnAsanaProjectLinkTest(String url) {
		// Given: US-141 - the Asana preset slot must LOOK like an Asana project link: Asana's own
		// host, pointing at something inside Asana rather than the bare front page
		List<PacingCampaignLink> links = List.of(new PacingCampaignLink("Asana", url));

		// When-Then:
		assertThatThrownBy(() -> validator.validate(links))
				.isInstanceOf(BusinessException.class)
				.hasMessage("The Asana link must point at an Asana project (an app.asana.com URL).");
	}

	@ParameterizedTest
	@ValueSource(strings = {
			"https://app.asana.com/0/1201234567890/list",
			"https://app.asana.com/1/1200000000000000/project/1201234567890/list",
			"HTTPS://APP.ASANA.COM/0/123/456"
	})
	void shouldAcceptBothAsanaProjectUrlShapesTest(String url) {
		// Given: Asana has shipped several project-URL shapes; the check is deliberately loose
		// beyond the host, or it would refuse links Asana itself hands out
		List<PacingCampaignLink> links = List.of(new PacingCampaignLink("Asana", url));

		// When-Then:
		assertThatCode(() -> validator.validate(links)).doesNotThrowAnyException();
	}

	@Test
	void shouldNotApplyTheAsanaRuleToOtherLinksTest() {
		// Given: a custom link that merely mentions Asana in its name is not the preset slot
		List<PacingCampaignLink> links = List.of(
				new PacingCampaignLink("Asana runbook", "https://example.com/how-we-use-asana"));

		// When-Then:
		assertThatCode(() -> validator.validate(links)).doesNotThrowAnyException();
	}
}
