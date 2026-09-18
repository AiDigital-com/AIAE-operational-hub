package com.aidigital.operationalhub.externalservices.pacing.config;

import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.impl.HubAssertionSignerImpl;
import com.aidigital.operationalhub.externalservices.pacing.impl.PacingClientImpl;
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
		// JdkClientHttpRequestFactory, NOT SimpleClientHttpRequestFactory.
		//
		// The simple factory runs on HttpURLConnection, whose method list is fixed and
		// does not include PATCH: every PATCH throws ProtocolException before a byte
		// leaves the process. Spring surfaces that as a RestClientException, which this
		// client maps to UNREACHABLE — so changing a pacing's status answered "the
		// Pacing service is currently unreachable" while Pacing was up and answering
		// the same call in 33ms. Every GET and POST worked, which is what made it look
		// like a network problem rather than a missing verb.
		//
		// This one wraps java.net.http.HttpClient, which supports PATCH. It ships with
		// spring-web; no new dependency.
		HttpClient httpClient = HttpClient.newBuilder()
				.connectTimeout(Duration.ofMillis(properties.getConnectTimeoutMs()))
				.build();
		JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
		// Read timeout stays on the factory: the JDK client's own timeout covers the
		// whole exchange, which would cut a slow response short rather than a slow
		// connect.
		requestFactory.setReadTimeout(Duration.ofMillis(properties.getReadTimeoutMs()));
		RestClient restClient = RestClient.builder()
				.baseUrl(properties.getBaseUrl())
				.requestFactory(requestFactory)
				.build();
		return new PacingClientImpl(restClient, assertionSigner, objectMapper);
	}
}
