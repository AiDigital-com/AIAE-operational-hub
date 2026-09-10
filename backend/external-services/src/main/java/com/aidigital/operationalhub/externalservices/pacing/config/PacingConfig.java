package com.aidigital.operationalhub.externalservices.pacing.config;

import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.impl.HubAssertionSignerImpl;
import com.aidigital.operationalhub.externalservices.pacing.impl.PacingClientImpl;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.time.Clock;

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
	 * @return the Pacing client
	 */
	@Bean
	public PacingClient pacingClient(PacingProperties properties, HubAssertionSigner assertionSigner) {
		SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
		requestFactory.setConnectTimeout((int) properties.getConnectTimeoutMs());
		requestFactory.setReadTimeout((int) properties.getReadTimeoutMs());
		RestClient restClient = RestClient.builder()
				.baseUrl(properties.getBaseUrl())
				.requestFactory(requestFactory)
				.build();
		return new PacingClientImpl(restClient, assertionSigner);
	}
}
