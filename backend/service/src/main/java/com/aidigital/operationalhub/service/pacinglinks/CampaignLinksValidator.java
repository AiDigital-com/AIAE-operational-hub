package com.aidigital.operationalhub.service.pacinglinks;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignLink;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Locale;

/**
 * Validates a campaign-links save before it reaches Pacing (§16 of the migration plan,
 * US-140/141).
 *
 * <p>This is the ONE settings fragment the Hub validates itself instead of deferring to Pacing:
 * Pacing stores {@code campaign_links} verbatim with no schema of its own (the links are pure
 * bookmarks nothing on that side follows), while the Hub renders every stored URL as a clickable
 * anchor. So the only gate between a pasted {@code javascript:} URL and a rendered link
 * is here. The scheme check is the load-bearing one; the length/count caps mirror the OpenAPI
 * contract's, and the Asana host check is US-141's explicit acceptance criterion.
 *
 * <p>Deliberately NOT validated: what a non-Asana link points at. A media plan may live anywhere,
 * a DSP console has dozens of host shapes - any allowlist here would refuse legitimate bookmarks.
 */
@Component
public class CampaignLinksValidator {

	/** Contract cap on how many links a pacing may keep ({@code PacingCampaignLinksUpdateV1.links}). */
	static final int MAX_LINKS = 50;

	/** Contract cap on a link name's length ({@code PacingCampaignLinkV1.name}). */
	static final int MAX_NAME_LENGTH = 120;

	/** Contract cap on a link URL's length ({@code PacingCampaignLinkV1.url}). */
	static final int MAX_URL_LENGTH = 2048;

	/** The preset slot name whose URL must look like an Asana project link (US-141). */
	static final String ASANA_PRESET_NAME = "Asana";

	/** The host every Asana project link lives under. */
	static final String ASANA_HOST = "app.asana.com";

	private static final String SCHEME_HTTP = "http";
	private static final String SCHEME_HTTPS = "https";

	/**
	 * Validates the whole list a save carries; a pass means every link is safe to store and render.
	 *
	 * @param links every link the pacing should keep after the save
	 * @throws BusinessException if the list is over the cap, or any link has a blank/over-long name,
	 *                           a missing/non-http(s)/over-long URL, or the {@code Asana} slot does
	 *                           not look like an Asana project link
	 */
	public void validate(List<PacingCampaignLink> links) {
		if (links.size() > MAX_LINKS) {
			throw new BusinessException(OperationalHubErrorReason.OPH_059, MAX_LINKS);
		}
		for (int index = 0; index < links.size(); index++) {
			validateLink(links.get(index), index);
		}
	}

	/**
	 * Validates one link of the list.
	 *
	 * @param link  the link to validate
	 * @param index its zero-based position, used to name a nameless offender in the error message
	 * @throws BusinessException if the link's name or URL breaks any of the class-level rules
	 */
	void validateLink(PacingCampaignLink link, int index) {
		String name = link.name() == null ? "" : link.name().trim();
		if (name.isEmpty()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_060, index + 1);
		}
		if (name.length() > MAX_NAME_LENGTH) {
			throw new BusinessException(OperationalHubErrorReason.OPH_061, name, MAX_NAME_LENGTH);
		}
		String url = link.url() == null ? "" : link.url().trim();
		if (url.length() > MAX_URL_LENGTH) {
			throw new BusinessException(OperationalHubErrorReason.OPH_063, name, MAX_URL_LENGTH);
		}
		URI parsed = parseHttpUrl(url, name);
		if (ASANA_PRESET_NAME.equals(name) && !looksLikeAsanaProject(parsed)) {
			throw new BusinessException(OperationalHubErrorReason.OPH_064);
		}
	}

	/**
	 * Parses a URL and requires it to be an absolute {@code http}/{@code https} one with a host -
	 * the gate that keeps {@code javascript:}, {@code data:} and bare words out of rendered links.
	 *
	 * @param url  the trimmed URL to parse
	 * @param name the link's name, for the error message
	 * @return the parsed URI
	 * @throws BusinessException if the URL does not parse, or is not absolute http(s) with a host
	 */
	URI parseHttpUrl(String url, String name) {
		URI parsed;
		try {
			parsed = new URI(url);
		} catch (URISyntaxException ex) {
			throw new BusinessException(OperationalHubErrorReason.OPH_062, ex, name);
		}
		String scheme = parsed.getScheme() == null ? "" : parsed.getScheme().toLowerCase(Locale.ROOT);
		boolean http = SCHEME_HTTP.equals(scheme) || SCHEME_HTTPS.equals(scheme);
		if (!http || parsed.getHost() == null || parsed.getHost().isEmpty()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_062, name);
		}
		return parsed;
	}

	/**
	 * Whether a URL looks like an Asana project link (US-141): hosted on {@code app.asana.com} (or a
	 * subdomain of {@code asana.com}) and pointing at something inside Asana rather than the bare
	 * front page. Deliberately loose beyond that - Asana has shipped several project-URL shapes
	 * ({@code /0/<id>/...}, {@code /1/<workspace>/project/<id>/...}) and pinning one of them would
	 * refuse links Asana itself hands out.
	 *
	 * @param parsed the already-parsed, already-http(s) URL
	 * @return true when it plausibly points at an Asana project
	 */
	boolean looksLikeAsanaProject(URI parsed) {
		String host = parsed.getHost().toLowerCase(Locale.ROOT);
		boolean asanaHost = ASANA_HOST.equals(host) || host.endsWith(".asana.com");
		String path = parsed.getPath() == null ? "" : parsed.getPath();
		return asanaHost && path.length() > 1;
	}
}
