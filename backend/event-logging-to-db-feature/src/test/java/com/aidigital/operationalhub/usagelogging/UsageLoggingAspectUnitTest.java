// Complements UsageLoggingAspectTest (Spring-AOP integration / pointcut) with
// fast, isolated unit tests of the aspect's package-private helpers and the
// logging-failure swallow path that the proxy-based test does not exercise.
package com.aidigital.operationalhub.usagelogging;

import com.aidigital.operationalhub.usagelogging.config.UsageLoggingProperties;
import com.aidigital.operationalhub.usagelogging.loggers.UsageLogger;
import com.aidigital.operationalhub.usagelogging.models.UsageEvent;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import java.lang.reflect.Method;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UsageLoggingAspectUnitTest {

    @Mock
    private UsageLogger usageLogger;

    @Mock
    private UsageLoggingProperties props;

    private final UsageAttributes usageAttributes = new UsageAttributes();
    private UsageLoggingAspect aspect;

    @BeforeEach
    void setUp() {
        aspect = new UsageLoggingAspect(usageLogger, props, usageAttributes);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        usageAttributes.clear();
    }

    /** A business service impl whose public methods carry no override annotation. */
    static class WidgetServiceImpl {
        public String doThing() {
            return "x";
        }
    }

    /** A service impl method carrying an explicit {@link LogUsage} override. */
    static class AnnotatedServiceImpl {
        @LogUsage(action = "custom.run", eventType = "job")
        public void run() {
        }
    }

    private static Jwt jwtWith(String claim, String value) {
        return Jwt.withTokenValue("token").header("alg", "none").claim(claim, value).build();
    }

    private ProceedingJoinPoint derivedServiceJoinPoint() throws NoSuchMethodException {
        Method method = WidgetServiceImpl.class.getDeclaredMethod("doThing");
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenReturn(method);
        when(signature.getDeclaringType()).thenReturn(WidgetServiceImpl.class);
        when(signature.getName()).thenReturn("doThing");
        ProceedingJoinPoint joinPoint = mock(ProceedingJoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);
        return joinPoint;
    }

    @Test
    void truncate_returnsNullForNull() {
        assertThat(aspect.truncate(null, 5)).isNull();
    }

    @Test
    void truncate_keepsValueWithinLimit() {
        assertThat(aspect.truncate("abc", 5)).isEqualTo("abc");
    }

    @Test
    void truncate_cutsValueAboveLimit() {
        assertThat(aspect.truncate("abcdef", 3)).isEqualTo("abc");
    }

    @Test
    void deriveAction_stripsServiceImplSuffixAndDecapitalises() {
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getDeclaringType()).thenReturn(WidgetServiceImpl.class);
        when(signature.getName()).thenReturn("doThing");
        ProceedingJoinPoint joinPoint = mock(ProceedingJoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);

        assertThat(aspect.deriveAction(joinPoint)).isEqualTo("widget.doThing");
    }

    @Test
    void resolveAction_prefersLogUsageActionOverride() throws NoSuchMethodException {
        Method method = AnnotatedServiceImpl.class.getDeclaredMethod("run");
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenReturn(method);
        ProceedingJoinPoint joinPoint = mock(ProceedingJoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);

        assertThat(aspect.resolveAction(joinPoint)).isEqualTo("custom.run");
    }

    @Test
    void resolveAction_derivesWhenNoAnnotation() throws NoSuchMethodException {
        assertThat(aspect.resolveAction(derivedServiceJoinPoint())).isEqualTo("widget.doThing");
    }

    @Test
    void resolveEventType_usesAnnotationValue() throws NoSuchMethodException {
        Method method = AnnotatedServiceImpl.class.getDeclaredMethod("run");
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenReturn(method);
        ProceedingJoinPoint joinPoint = mock(ProceedingJoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);

        assertThat(aspect.resolveEventType(joinPoint)).isEqualTo("job");
    }

    @Test
    void resolveEventType_defaultsToApiRequest() throws NoSuchMethodException {
        Method method = WidgetServiceImpl.class.getDeclaredMethod("doThing");
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenReturn(method);
        ProceedingJoinPoint joinPoint = mock(ProceedingJoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);

        assertThat(aspect.resolveEventType(joinPoint)).isEqualTo("api_request");
    }

    @Test
    void firstClaim_returnsFirstNonBlankValue() {
        Map<String, Object> claims = Map.of("b", "", "c", "value");

        assertThat(aspect.firstClaim(claims::get, new String[] {"a", "b", "c"})).isEqualTo("value");
    }

    @Test
    void firstClaim_returnsNullWhenNoAliasMatches() {
        Map<String, Object> claims = Map.of("x", "1");

        assertThat(aspect.firstClaim(claims::get, new String[] {"a", "b"})).isNull();
    }

    @Test
    void extractName_composesFirstAndLastWhenNoFullName() {
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "none")
            .claim("first_name", "Ada").claim("last_name", "Lovelace").build();
        Authentication auth = mock(Authentication.class);
        when(auth.getPrincipal()).thenReturn(jwt);

        assertThat(aspect.extractName(auth)).isEqualTo("Ada Lovelace");
    }

    @Test
    void extractName_returnsNullForNonJwtPrincipal() {
        Authentication auth = mock(Authentication.class);
        when(auth.getPrincipal()).thenReturn("not-a-jwt");

        assertThat(aspect.extractName(auth)).isNull();
    }

    @Test
    void extractName_returnsNullForNullAuthentication() {
        assertThat(aspect.extractName(null)).isNull();
    }

    @Test
    void extractEmail_readsEmailClaim() {
        Authentication auth = mock(Authentication.class);
        when(auth.getPrincipal()).thenReturn(jwtWith("email", "ada@example.com"));

        assertThat(aspect.extractEmail(auth)).isEqualTo("ada@example.com");
    }

    @Test
    void clientIp_returnsNullWithoutRequest() {
        assertThat(aspect.clientIp(null)).isNull();
    }

    @Test
    void clientIp_prefersFirstForwardedForHop() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader("X-Forwarded-For")).thenReturn("1.2.3.4, 5.6.7.8");

        assertThat(aspect.clientIp(request)).isEqualTo("1.2.3.4");
    }

    @Test
    void clientIp_fallsBackToRemoteAddr() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader("X-Forwarded-For")).thenReturn(null);
        when(request.getRemoteAddr()).thenReturn("9.9.9.9");

        assertThat(aspect.clientIp(request)).isEqualTo("9.9.9.9");
    }

    @Test
    void userAgent_returnsNullWithoutRequest() {
        assertThat(aspect.userAgent(null)).isNull();
    }

    @Test
    void buildEvent_populatesUserIdAndEmailFromAuthenticatedJwt() {
        Authentication auth = mock(Authentication.class);
        when(auth.isAuthenticated()).thenReturn(true);
        when(auth.getName()).thenReturn("user_123");
        when(auth.getPrincipal()).thenReturn(jwtWith("email", "ada@example.com"));
        SecurityContextHolder.getContext().setAuthentication(auth);
        when(props.getServiceName()).thenReturn("sample-service");
        when(props.getEnvironment()).thenReturn("test");

        UsageEvent event = aspect.buildEvent("widget.doThing", "api_request", null, 7L);

        assertThat(event.userId()).isEqualTo("user_123");
        assertThat(event.userEmail()).isEqualTo("ada@example.com");
        assertThat(event.status()).isEqualTo("success");
        assertThat(event.eventType()).isEqualTo("api_request");
        assertThat(event.durationMs()).isEqualTo(7L);
        assertThat(event.errorMessage()).isNull();
    }

    @Test
    void recordUsage_logsSuccessEventMergesAttributesAndClears() throws Throwable {
        ProceedingJoinPoint joinPoint = derivedServiceJoinPoint();
        when(joinPoint.proceed()).thenReturn("result");
        when(props.getServiceName()).thenReturn("sample-service");
        when(props.getEnvironment()).thenReturn("test");
        usageAttributes.put("document_id", "42");

        Object result = aspect.recordUsage(joinPoint);

        assertThat(result).isEqualTo("result");
        ArgumentCaptor<UsageEvent> captor = ArgumentCaptor.forClass(UsageEvent.class);
        verify(usageLogger).record(captor.capture());
        UsageEvent event = captor.getValue();
        assertThat(event.action()).isEqualTo("widget.doThing");
        assertThat(event.status()).isEqualTo("success");
        assertThat(event.eventType()).isEqualTo("api_request");
        assertThat(event.attributes()).containsEntry("document_id", "42");
        assertThat(usageAttributes.snapshot()).isNull();
    }

    @Test
    void recordUsage_logsErrorEventAndRethrows() throws Throwable {
        ProceedingJoinPoint joinPoint = derivedServiceJoinPoint();
        RuntimeException boom = new RuntimeException("boom");
        when(joinPoint.proceed()).thenThrow(boom);
        when(props.getServiceName()).thenReturn("sample-service");
        when(props.getEnvironment()).thenReturn("test");
        when(props.getMaxErrorMessageLength()).thenReturn(500);

        Throwable thrown = catchThrowable(() -> aspect.recordUsage(joinPoint));

        assertThat(thrown).isSameAs(boom);
        ArgumentCaptor<UsageEvent> captor = ArgumentCaptor.forClass(UsageEvent.class);
        verify(usageLogger).record(captor.capture());
        UsageEvent event = captor.getValue();
        assertThat(event.status()).isEqualTo("error");
        assertThat(event.eventType()).isEqualTo("error");
        assertThat(event.errorMessage()).isEqualTo("boom");
        assertThat(usageAttributes.snapshot()).isNull();
    }

    @Test
    void recordUsage_doesNotPropagateLoggingFailure() throws Throwable {
        ProceedingJoinPoint joinPoint = derivedServiceJoinPoint();
        when(joinPoint.proceed()).thenReturn("ok");
        when(props.getServiceName()).thenReturn("sample-service");
        when(props.getEnvironment()).thenReturn("test");
        doThrow(new RuntimeException("sink down")).when(usageLogger).record(any());

        Object result = aspect.recordUsage(joinPoint);

        assertThat(result).isEqualTo("ok");
        assertThat(usageAttributes.snapshot()).isNull();
    }
}
