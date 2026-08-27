package com.aidigital.operationalhub.service.agency.bigquery.model;

import com.aidigital.operationalhub.service.exception.AppException;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * SHA-256 hex hashing for {@code ConstructedIdGenerator} (PDI_117 D3) - a stateless static utility
 * alongside this package's other SQL/hashing helpers ({@link BqSql} is the existing precedent for a
 * static utility living here), kept separate from the service bean it supports the same way
 * {@code ReportRowKey.digest} is kept separate from the callers that need a deterministic row key.
 *
 * <p>Hashes a length-prefixed component list rather than a delimiter-joined string, mirroring
 * {@code ReportRowKey.digest} (the same problem this already solves elsewhere): every constructed name
 * contains {@code _}, so {@code scope + "_" + name} would be ambiguous - {@code ["ab", "c"]} and
 * {@code ["a", "bc"]} must not hash the same.
 */
public final class ConstructedIdHash {

	private static final String ALGORITHM = "SHA-256";
	private static final byte VALUE_MARKER = 2;

	private ConstructedIdHash() {
		// static utility only
	}

	/**
	 * Hashes the given components as a length-prefixed list and renders the digest as lowercase hex.
	 *
	 * @param components the ordered components to hash; none may be {@code null}
	 * @return the full hex-encoded digest
	 */
	public static String sha256Hex(List<String> components) {
		try {
			MessageDigest digest = MessageDigest.getInstance(ALGORITHM);
			for (String component : components) {
				byte[] bytes = component.getBytes(StandardCharsets.UTF_8);
				digest.update(VALUE_MARKER);
				digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
				digest.update(bytes);
			}
			return HexFormat.of().formatHex(digest.digest());
		} catch (NoSuchAlgorithmException exception) {
			throw new AppException("%s is not available on this JVM", exception, ALGORITHM);
		}
	}
}
