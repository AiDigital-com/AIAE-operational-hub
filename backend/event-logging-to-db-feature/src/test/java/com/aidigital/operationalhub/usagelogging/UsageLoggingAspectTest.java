// Proves UsageLoggingAspect AUTO-intercepts every public *ServiceImpl method
// with no annotation needed — the exact behaviour that previously failed
// silently when service methods were left un-annotated. Uses a real Spring AOP
// proxy (not a mocked join point) so the pointcut itself is under test.
package com.aidigital.operationalhub.usagelogging;

import com.aidigital.operationalhub.service.demo.services.impl.DemoServiceImpl;
import com.aidigital.operationalhub.usagelogging.config.UsageLoggingProperties;
import com.aidigital.operationalhub.usagelogging.loggers.UsageLogger;
import com.aidigital.operationalhub.usagelogging.models.UsageEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;

@SpringJUnitConfig(UsageLoggingAspectTest.TestConfig.class)
class UsageLoggingAspectTest {

    @Configuration
    @EnableAspectJAutoProxy
    static class TestConfig {

        @Bean
        UsageLogger usageLogger() {
            return mock(UsageLogger.class);
        }

        @Bean
        UsageLoggingProperties usageLoggingProperties() {
            UsageLoggingProperties props = new UsageLoggingProperties();
            props.setServiceName("test-service");
            props.setEnvironment("test");
            return props;
        }

        @Bean
        UsageAttributes usageAttributes() {
            return new UsageAttributes();
        }

        @Bean
        UsageLoggingAspect usageLoggingAspect(UsageLogger logger, UsageLoggingProperties props,
                                              UsageAttributes usageAttributes) {
            return new UsageLoggingAspect(logger, props, usageAttributes);
        }

        @Bean
        DemoServiceImpl demoServiceImpl() {
            return new DemoServiceImpl();
        }
    }

    @Autowired
    private UsageLogger usageLogger;

    @Autowired
    private DemoServiceImpl demoService;

    @BeforeEach
    void resetSink() {
        reset(usageLogger);
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void shouldAutoLogServiceImplMethodWithDerivedActionTest() {
        demoService.doThing();

        ArgumentCaptor<UsageEvent> captor = ArgumentCaptor.forClass(UsageEvent.class);
        verify(usageLogger).record(captor.capture());
        UsageEvent event = captor.getValue();
        assertThat(event.action()).isEqualTo("demo.doThing");
        assertThat(event.status()).isEqualTo("success");
        assertThat(event.service()).isEqualTo("test-service");
        assertThat(event.environment()).isEqualTo("test");
    }

    @Test
    void shouldRecordErrorWhenServiceMethodThrowsTest() {
        Throwable thrown = catchThrowable(() -> demoService.boom());

        assertThat(thrown).isInstanceOf(IllegalStateException.class);
        ArgumentCaptor<UsageEvent> captor = ArgumentCaptor.forClass(UsageEvent.class);
        verify(usageLogger).record(captor.capture());
        UsageEvent event = captor.getValue();
        assertThat(event.action()).isEqualTo("demo.boom");
        assertThat(event.status()).isEqualTo("error");
        assertThat(event.eventType()).isEqualTo("error");
        assertThat(event.errorMessage()).contains("kaboom");
    }

    @Test
    void shouldUseLogUsageActionOverrideWhenAnnotatedTest() {
        demoService.custom();

        ArgumentCaptor<UsageEvent> captor = ArgumentCaptor.forClass(UsageEvent.class);
        verify(usageLogger).record(captor.capture());
        assertThat(captor.getValue().action()).isEqualTo("custom.action.name");
    }

    /**
     * Proves that userId comes from the configured principal-name claim (user_id),
     * not accidentally from JwtAuthenticationToken's default subject fallback.
     * SecurityConfig sets setPrincipalClaimName("user_id"); the test mirrors that
     * by building a JwtAuthenticationToken through the same converter.
     */
    @Test
    void shouldCaptureUserIdFromUserIdClaimNotSubjectTest() {
        // Given: a Clerk JWT where user_id differs from sub
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "none")
            .subject("sub-irrelevant")
            .claim("user_id", "user_clerk_abc123")
            .claim("email", "jane@aidigital.com")
            .claim("full_name", "Jane Doe")
            .issuedAt(Instant.now())
            .expiresAt(Instant.now().plusSeconds(60))
            .build();

        // Mirror SecurityConfig's principal claim name
        JwtAuthenticationConverter conv = new JwtAuthenticationConverter();
        conv.setPrincipalClaimName("user_id");
        var token = conv.convert(jwt);
        SecurityContextHolder.getContext().setAuthentication(token);

        demoService.doThing();

        ArgumentCaptor<UsageEvent> captor = ArgumentCaptor.forClass(UsageEvent.class);
        verify(usageLogger).record(captor.capture());
        UsageEvent event = captor.getValue();

        // userId must come from the user_id claim, NOT from sub
        assertThat(event.userId()).isEqualTo("user_clerk_abc123");
        assertThat(event.userEmail()).isEqualTo("jane@aidigital.com");
        assertThat(event.attributes()).containsEntry("user_name", "Jane Doe");
    }

    @Test
    void shouldCaptureUserEmailAndNameFromJwtPrincipalTest() {
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "none")
            .subject("user_sub1")
            .claim("user_id", "user_sub1")
            .claim("email", "jane@aidigital.com")
            .claim("full_name", "Jane Doe")
            .issuedAt(Instant.now())
            .expiresAt(Instant.now().plusSeconds(60))
            .build();
        JwtAuthenticationConverter conv = new JwtAuthenticationConverter();
        conv.setPrincipalClaimName("user_id");
        SecurityContextHolder.getContext().setAuthentication(conv.convert(jwt));

        demoService.doThing();

        ArgumentCaptor<UsageEvent> captor = ArgumentCaptor.forClass(UsageEvent.class);
        verify(usageLogger).record(captor.capture());
        UsageEvent event = captor.getValue();
        assertThat(event.userEmail()).isEqualTo("jane@aidigital.com");
        assertThat(event.userId()).isEqualTo("user_sub1");
        assertThat(event.attributes()).containsEntry("user_name", "Jane Doe");
    }
}
