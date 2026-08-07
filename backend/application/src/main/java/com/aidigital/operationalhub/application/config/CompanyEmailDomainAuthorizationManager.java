package com.aidigital.operationalhub.application.config;

import com.aidigital.operationalhub.application.config.properties.ClerkProperties;
import com.aidigital.operationalhub.service.rbac.enums.ClerkJwtClaim;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.function.Supplier;

/**
 * Post-authentication authorization policy that restricts access to the configured email domain.
 *
 * <p>Missing or invalid JWT remains a 401 from the resource server. A valid JWT with a missing or
 * foreign email claim is denied here as 403.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CompanyEmailDomainAuthorizationManager
		implements AuthorizationManager<RequestAuthorizationContext> {

	private static final String DENY_REASON_NOT_JWT = "authentication_is_not_jwt";
	private static final String DENY_REASON_MISSING_EMAIL = "missing_email_claim";
	private static final String DENY_REASON_EMPTY_DOMAIN = "empty_allowed_email_domain";
	private static final String DENY_REASON_DOMAIN_MISMATCH = "email_domain_mismatch";

	private final ClerkProperties clerkProperties;

	@Override
	public AuthorizationDecision check(
			Supplier<Authentication> authentication,
			RequestAuthorizationContext context) {
		Authentication auth = authentication.get();
		if (!(auth instanceof JwtAuthenticationToken jwtAuthentication)) {
			log.warn("Clerk access denied: reason={}, authenticationType={}",
					DENY_REASON_NOT_JWT, auth == null ? "null" : auth.getClass().getName());
			return new AuthorizationDecision(false);
		}
		String email = jwtAuthentication.getToken().getClaimAsString(
				ClerkJwtClaim.EMAIL.getClaimName());
		AuthorizationDecision decision = new AuthorizationDecision(isAllowedEmail(email));
		if (!decision.isGranted()) {
			log.warn("Clerk access denied: reason={}, emailDomain={}, allowedEmailDomain={}",
					resolveDenyReason(email), extractDomain(email),
					normalizeDomain(clerkProperties.getAllowedEmailDomain()));
		}
		return decision;
	}

	/**
	 * Decides whether the provided email belongs exactly to the configured company domain.
	 *
	 * @param email raw email claim value
	 * @return {@code true} when the domain exactly matches the configured allow-list domain
	 */
	public boolean isAllowedEmail(String email) {
		if (email == null || email.isBlank()) {
			return false;
		}
		String domain = normalizeDomain(clerkProperties.getAllowedEmailDomain());
		if (domain.isBlank()) {
			return false;
		}
		String normalized = email.trim().toLowerCase(Locale.ROOT);
		int at = normalized.lastIndexOf('@');
		if (at < 0 || at == normalized.length() - 1) {
			return false;
		}
		return domain.equals(normalized.substring(at + 1));
	}

	/**
	 * Resolves a safe denial reason for logging.
	 *
	 * @param email raw email claim value
	 * @return denial reason without sensitive token data
	 */
	public String resolveDenyReason(String email) {
		if (email == null || email.isBlank()) {
			return DENY_REASON_MISSING_EMAIL;
		}
		String domain = normalizeDomain(clerkProperties.getAllowedEmailDomain());
		if (domain.isBlank()) {
			return DENY_REASON_EMPTY_DOMAIN;
		}
		return DENY_REASON_DOMAIN_MISMATCH;
	}

	/**
	 * Extracts only the email domain for safe diagnostics.
	 *
	 * @param email raw email claim value
	 * @return normalized domain part or blank string
	 */
	public String extractDomain(String email) {
		if (email == null || email.isBlank()) {
			return "";
		}
		String normalized = email.trim().toLowerCase(Locale.ROOT);
		int at = normalized.lastIndexOf('@');
		if (at < 0 || at == normalized.length() - 1) {
			return "";
		}
		return normalized.substring(at + 1);
	}

	/**
	 * Normalizes the configured company domain for comparison.
	 *
	 * @param domain configured domain value
	 * @return trimmed lower-case domain without a leading {@code @}
	 */
	public String normalizeDomain(String domain) {
		if (domain == null) {
			return "";
		}
		String normalized = domain.trim().toLowerCase(Locale.ROOT);
		if (normalized.startsWith("@")) {
			normalized = normalized.substring(1);
		}
		return normalized;
	}
}
