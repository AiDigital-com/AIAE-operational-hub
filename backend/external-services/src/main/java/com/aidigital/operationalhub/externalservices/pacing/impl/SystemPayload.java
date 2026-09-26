package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * The signed JSON payload shape for {@link HubAssertionSignerImpl#signSystem()}: no email, no
 * scope, no {@code can_create} — just the fixed marker dash-gate's {@code verifySystemAssertion}
 * requires.
 *
 * @param system always {@code true}
 * @param exp    expiry, epoch milliseconds
 */
record SystemPayload(boolean system, long exp) {
}
