package com.aidigital.operationalhub.application.config;

import com.aidigital.operationalhub.application.config.properties.ClerkProperties;
import com.aidigital.operationalhub.service.rbac.enums.ClerkJwtClaim;
import lombok.RequiredArgsConstructor;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;

/**
 * Validates the Clerk {@code aidigital-api} JWT contract in the resource-server layer.
 *
 * <p>Failures here produce HTTP 401. Company-email-domain authorization is enforced after
 * authentication and produces HTTP 403.
 */
@Component
@RequiredArgsConstructor
public class ClerkJwtClaimsValidator implements OAuth2TokenValidator<Jwt> {

	private static final String ERROR_CODE = "invalid_token";
	private static final String AZP_CLAIM = "azp";

	private final ClerkProperties clerkProperties;

	@Override
	public OAuth2TokenValidatorResult validate(Jwt jwt) {
		String subject = jwt.getSubject();
		String userId = jwt.getClaimAsString(ClerkJwtClaim.USER_ID.getClaimName());
		if (subject == null || subject.isBlank() || userId == null || userId.isBlank()) {
			return invalidToken("Missing sub or user_id claim.");
		}
		if (!subject.equals(userId)) {
			return invalidToken("sub and user_id must match.");
		}
		String authorizedParty = jwt.getClaimAsString(AZP_CLAIM);
		if (authorizedParty == null || authorizedParty.isBlank()
				|| !authorizedParties().contains(authorizedParty)) {
			return invalidToken("Authorized party is not trusted.");
		}
		return OAuth2TokenValidatorResult.success();
	}

	/**
	 * Parses exact trusted browser origins from {@code app.auth.authorized-parties}.
	 *
	 * @return configured trusted origins
	 */
	public List<String> authorizedParties() {
		String raw = clerkProperties.getAuthorizedParties();
		if (raw == null || raw.isBlank()) {
			return List.of();
		}
		return Arrays.stream(raw.split(","))
				.map(String::trim)
				.filter(value -> !value.isEmpty())
				.toList();
	}

	/**
	 * Builds a failed OAuth2 token validation result.
	 *
	 * @param description failure description
	 * @return failed validation result
	 */
	public OAuth2TokenValidatorResult invalidToken(String description) {
		return OAuth2TokenValidatorResult.failure(new OAuth2Error(ERROR_CODE, description, null));
	}
}
