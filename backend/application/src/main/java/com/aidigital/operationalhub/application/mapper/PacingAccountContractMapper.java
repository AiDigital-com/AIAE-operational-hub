package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAccountV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNotifyDestinationV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAccount;
import org.springframework.stereotype.Component;

/**
 * Between Pacing's account preferences and this API's contract (Account Settings, "Daily
 * Summary"). Renaming only - Pacing owns and validates {@code notify_destination} and
 * {@code slack_channel_id} (including checking a changed group id against Slack); no rule about
 * either is re-applied here.
 */
@Component
public class PacingAccountContractMapper {

	/**
	 * Reads the account preferences for the contract.
	 *
	 * @param account the preferences Pacing returned
	 * @return the generated {@link PacingAccountV1}
	 */
	public PacingAccountV1 toV1(PacingAccount account) {
		PacingNotifyDestinationV1 notifyDestination = PacingNotifyDestinationV1.fromValue(account.notifyDestination());
		return new PacingAccountV1()
				.notifyDestination(notifyDestination)
				.slackChannelId(account.slackChannelId())
				.slackWarning(account.slackWarning());
	}
}
