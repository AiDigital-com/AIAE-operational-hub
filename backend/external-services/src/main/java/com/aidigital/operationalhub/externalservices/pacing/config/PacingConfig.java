package com.aidigital.operationalhub.externalservices.pacing.config;

import com.aidigital.operationalhub.externalservices.pacing.PacingCampaignAccessClient;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.PacingLibraryVisibilityClient;
import com.aidigital.operationalhub.externalservices.pacing.PacingSheetSourceClient;
import com.aidigital.operationalhub.externalservices.pacing.PacingSummarySwitchClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.impl.HubAssertionSignerImpl;
import com.aidigital.operationalhub.externalservices.pacing.impl.OrderNumberCollector;
import com.aidigital.operationalhub.externalservices.pacing.impl.PacingCampaignAccessClientImpl;
import com.aidigital.operationalhub.externalservices.pacing.impl.PacingClientImpl;
import com.aidigital.operationalhub.externalservices.pacing.impl.PacingLibraryVisibilityClientImpl;
import com.aidigital.operationalhub.externalservices.pacing.impl.PacingSheetSourceClientImpl;
import com.aidigital.operationalhub.externalservices.pacing.impl.PacingSummarySwitchClientImpl;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Duration;

/**
 * Wires the {@link PacingClient} and its {@link HubAssertionSigner}.
 *
 * <p>Unlike {@code BigQueryConfig}, there is no stub/production split here: Pacing runs locally at
 * {@code http://localhost:3000} (see {@code docker-compose.local.yml} in the Pacing repo) the same way
 * it runs anywhere else, so one client wiring serves every profile.
 */
@Configuration
@EnableConfigurationProperties(PacingProperties.class)
public class PacingConfig {

	/**
	 * Signs assertions with the shared secret, using the system clock for {@code exp}.
	 *
	 * @param properties Pacing configuration properties
	 * @return the assertion signer
	 */
	@Bean
	public HubAssertionSigner hubAssertionSigner(PacingProperties properties) {
		return new HubAssertionSignerImpl(properties, Clock.systemUTC());
	}

	/**
	 * Pacing HTTP client, bound to the configured base URL and connect/read timeouts.
	 *
	 * @param properties       Pacing configuration properties
	 * @param assertionSigner  signs the {@code X-Hub-Assertion} header on every call
	 * @param objectMapper     the Hub's own configured Jackson mapper, reused to parse the structured
	 *                         fields (a countdown, a revision, a conflict stamp) out of a non-2xx
	 *                         response body - see {@code PacingClientImpl#readBody}
	 * @return the Pacing client
	 */
	@Bean
	public PacingClient pacingClient(
			PacingProperties properties, HubAssertionSigner assertionSigner, ObjectMapper objectMapper) {
		// The collector is a plain stateless collaborator of the client, constructed with it here
		// rather than registered as its own bean - nothing else depends on it.
		return new PacingClientImpl(
				pacingRestClient(properties, properties.getReadTimeoutMs()), assertionSigner, objectMapper,
				new OrderNumberCollector());
	}

	/**
	 * The three sheet-source calls, on their own client.
	 *
	 * <p>A second bean rather than more methods on {@link PacingClient}: these are the only Pacing
	 * calls that read a file the user names, and "we could not open it" is an answer there rather
	 * than a failure. They share this one's transport settings through {@link #pacingRestClient}.
	 *
	 * @param properties      Pacing configuration properties
	 * @param assertionSigner signs the {@code X-Hub-Assertion} header on every call
	 * @param objectMapper    the Hub's own Jackson mapper, used to read Pacing's error bodies
	 * @return the sheet-source client
	 */
	@Bean
	public PacingSheetSourceClient pacingSheetSourceClient(
			PacingProperties properties, HubAssertionSigner assertionSigner, ObjectMapper objectMapper) {
		return new PacingSheetSourceClientImpl(
				pacingRestClient(properties, properties.getSheetReadTimeoutMs()), assertionSigner, objectMapper);
	}

	/**
	 * The daily Slack summaries switch, on its own client: {@link PacingClient} is at the file-length
	 * cap. Same transport settings as the main client.
	 *
	 * @param properties      Pacing configuration properties
	 * @param assertionSigner signs the {@code X-Hub-Assertion} header on every call
	 * @param objectMapper    the Hub's own Jackson mapper, used to read Pacing's error bodies
	 * @return the switch client
	 */
	@Bean
	public PacingSummarySwitchClient pacingSummarySwitchClient(
			PacingProperties properties, HubAssertionSigner assertionSigner, ObjectMapper objectMapper) {
		return new PacingSummarySwitchClientImpl(
				pacingRestClient(properties, properties.getReadTimeoutMs()), assertionSigner, objectMapper);
	}

	/**
	 * Only me / Team for a library entry, on its own client: {@link PacingClient} is at the
	 * file-length cap. Same transport settings as the main client.
	 *
	 * @param properties      Pacing configuration properties
	 * @param assertionSigner signs the {@code X-Hub-Assertion} header on every call
	 * @param objectMapper    the Hub's own Jackson mapper, used to read Pacing's error bodies
	 * @return the library visibility client
	 */
	@Bean
	public PacingLibraryVisibilityClient pacingLibraryVisibilityClient(
			PacingProperties properties, HubAssertionSigner assertionSigner, ObjectMapper objectMapper) {
		return new PacingLibraryVisibilityClientImpl(
				pacingRestClient(properties, properties.getReadTimeoutMs()), assertionSigner, objectMapper);
	}

	/**
	 * The campaign-access calls (2026-10-23), on their own client: {@link PacingClient} is at the
	 * file-length cap, and these run under the SYSTEM assertion rather than a user's. Same transport
	 * settings as the main client.
	 *
	 * @param properties      Pacing configuration properties
	 * @param assertionSigner signs the system {@code X-Hub-Assertion} header on every call
	 * @param objectMapper    the Hub's own Jackson mapper, used to read Pacing's error bodies
	 * @return the campaign-access client
	 */
	@Bean
	public PacingCampaignAccessClient pacingCampaignAccessClient(
			PacingProperties properties, HubAssertionSigner assertionSigner, ObjectMapper objectMapper) {
		return new PacingCampaignAccessClientImpl(
				pacingRestClient(properties, properties.getReadTimeoutMs()), assertionSigner, objectMapper);
	}

	/**
	 * One Pacing transport, built the same way for every client of it.
	 *
	 * <p>JdkClientHttpRequestFactory, NOT SimpleClientHttpRequestFactory. The simple factory runs on
	 * HttpURLConnection, whose method list is fixed and does not include PATCH: every PATCH throws
	 * ProtocolException before a byte leaves the process. Spring surfaces that as a
	 * RestClientException, which the client maps to UNREACHABLE — so changing a pacing's status
	 * answered "the Pacing service is currently unreachable" while Pacing was up and answering the
	 * same call in 33ms. Every GET and POST worked, which is what made it look like a network problem
	 * rather than a missing verb. This one wraps java.net.http.HttpClient, which supports PATCH. It
	 * ships with spring-web; no new dependency.
	 *
	 * @param properties    Pacing configuration properties
	 * @param readTimeoutMs how long to wait for the response; the sheet-source calls read a Google
	 *                      spreadsheet and need far longer than the rest
	 * @return a RestClient bound to Pacing's base URL and the given timeout
	 */
	RestClient pacingRestClient(PacingProperties properties, long readTimeoutMs) {
		HttpClient httpClient = HttpClient.newBuilder()
				.connectTimeout(Duration.ofMillis(properties.getConnectTimeoutMs()))
				.build();
		JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
		// Read timeout stays on the factory: the JDK client's own timeout covers the
		// whole exchange, which would cut a slow response short rather than a slow
		// connect.
		requestFactory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
		return RestClient.builder()
				.baseUrl(properties.getBaseUrl())
				.requestFactory(requestFactory)
				.build();
	}
}
