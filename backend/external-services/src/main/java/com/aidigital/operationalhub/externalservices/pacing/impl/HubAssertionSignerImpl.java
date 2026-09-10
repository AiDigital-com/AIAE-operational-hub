package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.config.PacingProperties;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Default {@link HubAssertionSigner}, matching dash-gate's {@code tools/mint-assertion.mjs} exactly:
 * same compact JSON payload shape and field order, same base64url encoding, same HMAC-SHA256 over the
 * base64url payload string.
 *
 * <p>Field order in {@link Payload} (email, scope, can_create, exp) and in the {@code scope} map
 * (kind, then ids) is deliberate: Jackson serializes a record in its declared component order by
 * default, so the emitted JSON text is byte-identical to Node's {@code JSON.stringify} on the
 * equivalent object literal. That byte-identity is not required for correctness (Pacing verifies the
 * signature over the opaque {@code payloadB64} string and separately parses it — it never
 * re-serializes and compares), but it is what lets a cross-language test assert this implementation
 * produces the exact same header as the Node reference for the same inputs.
 */
@RequiredArgsConstructor
public class HubAssertionSignerImpl implements HubAssertionSigner {

	private static final String HMAC_ALGORITHM = "HmacSHA256";

	private final PacingProperties properties;
	private final Clock clock;
	private final ObjectMapper objectMapper = new ObjectMapper();

	@Override
	public String sign(HubAssertion assertion) {
		Map<String, Object> scope = new LinkedHashMap<>();
		scope.put("kind", assertion.scopeKind());
		if (!HubAssertion.KIND_ALL.equals(assertion.scopeKind())) {
			scope.put("ids", assertion.scopeIds());
		}
		long exp = clock.millis() + Duration.ofSeconds(properties.getAssertionTtlSeconds()).toMillis();
		Payload payload = new Payload(assertion.email(), scope, assertion.canCreate(), exp);

		try {
			String json = objectMapper.writeValueAsString(payload);
			String payloadB64 = base64Url(json.getBytes(StandardCharsets.UTF_8));
			String signature = base64Url(hmac(payloadB64));
			return payloadB64 + "." + signature;
		} catch (JsonProcessingException | GeneralSecurityException ex) {
			// Both are defensive: HmacSHA256 is always available from the default JCE providers and
			// Payload is a trivial record, so neither is expected to actually fire in practice.
			throw new PacingExternalException("Failed to build the Hub assertion header", ex);
		}
	}

	@Override
	public String signSystem() {
		long exp = clock.millis() + Duration.ofSeconds(properties.getAssertionTtlSeconds()).toMillis();
		SystemPayload payload = new SystemPayload(true, exp);
		try {
			String json = objectMapper.writeValueAsString(payload);
			String payloadB64 = base64Url(json.getBytes(StandardCharsets.UTF_8));
			String signature = base64Url(hmac(payloadB64));
			return payloadB64 + "." + signature;
		} catch (JsonProcessingException | GeneralSecurityException ex) {
			// Defensive, as in sign() above: neither is expected to actually fire in practice.
			throw new PacingExternalException("Failed to build the Pacing system assertion header", ex);
		}
	}

	private byte[] hmac(String payloadB64) throws GeneralSecurityException {
		Mac mac = Mac.getInstance(HMAC_ALGORITHM);
		mac.init(new SecretKeySpec(
				properties.getAssertionSecret().getBytes(StandardCharsets.UTF_8), HMAC_ALGORITHM));
		return mac.doFinal(payloadB64.getBytes(StandardCharsets.US_ASCII));
	}

	private static String base64Url(byte[] bytes) {
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	/**
	 * The signed JSON payload shape, field order matching dash-gate's assertion payload exactly.
	 *
	 * @param email     the asserted user's email
	 * @param scope     the scope map ({@code kind}, then {@code ids} when present)
	 * @param canCreate serialized as {@code can_create}
	 * @param exp       expiry, epoch milliseconds
	 */
	private record Payload(
			String email,
			Map<String, Object> scope,
			@JsonProperty("can_create") boolean canCreate,
			long exp) {
	}

	/**
	 * The signed JSON payload shape for {@link #signSystem()}: no email, no scope, no {@code can_create}
	 * — just the fixed marker dash-gate's {@code verifySystemAssertion} requires.
	 *
	 * @param system always {@code true}
	 * @param exp    expiry, epoch milliseconds
	 */
	private record SystemPayload(boolean system, long exp) {
	}
}
