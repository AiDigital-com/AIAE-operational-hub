package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegation;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegationGrant;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * Between Pacing's delegation shapes and this API's contract (§12 of the migration plan).
 *
 * <p>Renaming and date parsing only. None of the rules a delegation is subject to are applied here:
 * they are database constraints and endpoint checks in Pacing, which is where the access they govern
 * is actually decided. A copy on this side would be a second opinion, and the day the two disagree
 * the wrong one would be the one the user sees.
 */
@Component
public class PacingDelegationContractMapper {

	/**
	 * Reads one delegation for the contract.
	 *
	 * @param delegation  the delegation Pacing returned
	 * @param callerEmail the current user's email - the identifier the Hub asserts and Pacing
	 *                    resolves its users by, and so the only one both sides already agree on
	 * @return the generated {@link PacingDelegationV1}
	 */
	public PacingDelegationV1 toV1(PacingDelegation delegation, String callerEmail) {
		return new PacingDelegationV1()
				.delegationId(delegation.delegationId())
				.delegatorId(delegation.delegatorId())
				.delegatorName(delegation.delegatorName())
				.delegatorEmail(delegation.delegatorEmail())
				.delegateId(delegation.delegateId())
				.delegateName(delegation.delegateName())
				.delegateEmail(delegation.delegateEmail())
				.startsAt(parseInstant(delegation.startsAt()))
				.expiresAt(parseInstant(delegation.expiresAt()))
				.reason(delegation.reason())
				.pacingId(delegation.pacingId())
				.pacingName(delegation.pacingName())
				.dashSlug(delegation.dashSlug())
				.pacingCount(delegation.pacingCount())
				.direction(directionFor(delegation, callerEmail));
	}

	/**
	 * Which side of a grant the caller is on.
	 *
	 * <p>Matched on email rather than on ids: a delegation is keyed on PACING user ids, and the Hub's
	 * own session carries none. Case-insensitive, because the two systems store what their sources
	 * gave them and neither promises a casing.
	 *
	 * <p>Defaults to {@code received} when the delegator is somebody else OR cannot be identified. A
	 * grant wrongly filed as mine offers a Revoke button for access I never gave; filed as received it
	 * is merely listed. Of the two ways to be wrong, only one of them can act.
	 *
	 * @param delegation  the delegation
	 * @param callerEmail the current user's email
	 * @return granted when the caller gave this access, received otherwise
	 */
	PacingDelegationV1.DirectionEnum directionFor(PacingDelegation delegation, String callerEmail) {
		String delegator = delegation.delegatorEmail();
		boolean mine = callerEmail != null && !callerEmail.isBlank()
				&& delegator != null && delegator.equalsIgnoreCase(callerEmail);
		return mine ? PacingDelegationV1.DirectionEnum.GRANTED : PacingDelegationV1.DirectionEnum.RECEIVED;
	}

	/**
	 * Reads a grant request into the external-services model.
	 *
	 * @param body the request body
	 * @return the grant to forward to Pacing
	 */
	public PacingDelegationGrant toGrant(PacingDelegationCreateV1 body) {
		return new PacingDelegationGrant(
				body.getDelegateId(),
				body.getStartsAt() == null ? null : body.getStartsAt().toString(),
				body.getExpiresAt() == null ? null : body.getExpiresAt().toString(),
				body.getReason(),
				// Empty and absent mean the same thing to Pacing - everything the delegator owns - and
				// the client below turns both into an omitted key.
				body.getPacingIds() == null ? List.of() : body.getPacingIds());
	}

	/**
	 * Parses a timestamp Pacing wrote, degrading to null rather than failing the whole read.
	 *
	 * <p>A delegation whose dates cannot be parsed is still worth listing: its recipient, its scope
	 * and its revoke button are all intact, and a null date reads as "unknown" where an exception
	 * would have taken every OTHER delegation off the screen with it.
	 *
	 * @param value the stored timestamp
	 * @return the parsed value, or null
	 */
	LocalDateTime parseInstant(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		try {
			// Normalised to UTC before the offset is dropped. Pacing writes these with toISOString(),
			// so they arrive as UTC already - but reading the local part of whatever offset happened to
			// be on the string would turn a future change of that into a silent shift of every date on
			// this screen.
			return OffsetDateTime.parse(value).withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime();
		} catch (DateTimeParseException ignored) {
			try {
				String datePart = value.substring(0, Math.min(10, value.length()));
				return LocalDate.parse(datePart).atStartOfDay();
			} catch (RuntimeException alsoIgnored) {
				return null;
			}
		}
	}
}
