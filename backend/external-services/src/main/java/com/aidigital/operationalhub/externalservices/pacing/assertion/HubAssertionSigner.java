package com.aidigital.operationalhub.externalservices.pacing.assertion;

/**
 * Builds and signs the {@code X-Hub-Assertion} header value every call to Pacing must carry.
 *
 * <p>The header is {@code <payloadB64url>.<sigB64url>}, where {@code payloadB64url} is the base64url
 * encoding of the UTF-8 JSON payload {@code {email, scope, can_create, exp}} ({@code exp} in epoch
 * milliseconds), and {@code sigB64url} is the base64url encoding of an HMAC-SHA256 over the
 * {@code payloadB64url} ASCII string itself — not over the raw JSON — keyed with the shared secret.
 * Base64url is standard base64 with {@code +}→{@code -}, {@code /}→{@code _}, and all {@code =}
 * padding stripped. This must byte-for-byte match dash-gate's {@code tools/mint-assertion.mjs}, which
 * verifies it.
 */
public interface HubAssertionSigner {

	/**
	 * Name of the HTTP header every Pacing request carries.
	 */
	String HEADER_NAME = "X-Hub-Assertion";

	/**
	 * Signs the given assertion, computing a fresh {@code exp} short TTL into the future from the
	 * signer's clock.
	 *
	 * @param assertion who is calling, what they may see, and whether they may create a pacing
	 * @return the {@code <payloadB64url>.<sigB64url>} header value
	 */
	String sign(HubAssertion assertion);

	/**
	 * Signs a SYSTEM assertion for {@code /api/internal/*} calls: {@code {system: true, exp}}, no email
	 * and no scope. Used only for the employee sync (§2 of the migration plan), which has no acting
	 * user — including on a fresh database, before {@code access.users} holds a single row an email
	 * could resolve against. dash-gate verifies this exact shape with a separate function
	 * ({@code verifySystemAssertion}) from the one it uses for {@link #sign}, and rejects either shape
	 * on the other's routes.
	 *
	 * @return the {@code <payloadB64url>.<sigB64url>} header value
	 */
	String signSystem();
}
