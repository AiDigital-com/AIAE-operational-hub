// UsageLoggingAspect — AUTO-intercepts every public method of every business
// service impl (*ServiceImpl in service/<aggregate>/services/impl/) and records
// a UsageEvent via UsageLogger. No annotation required, so usage logging can
// never be "forgotten"; apply @LogUsage only to override the derived action
// name or event type. Behaviour invariants (preserve on every edit):
//  1. Self-invocation bypasses Spring AOP proxy → aspect won't fire.
//  2. @Order(LOWEST_PRECEDENCE - 100) — OUTER than @Transactional, so the
//     usage event reflects final commit/rollback outcome.
//  3. try { proceed() } catch (Throwable) { rethrow } finally { log }
//     — logs success + failure, never swallows.
//  4. SecurityContextHolder + UsageAttributes are ThreadLocal; for @Async
//     paths use MODE_INHERITABLETHREADLOCAL or DelegatingSecurityContextRunnable.
//  5. Logger is @Async (off-thread DB write). Aspect only assembles + hands off
//     — assembly must be cheap (no I/O).
//  6. joinPoint.getArgs() deliberately ignored — no payload/JWT/PII leakage.
//     Callers populate per-row attributes via usageAttributes.put(...).
//  7. SecurityConfig wires JwtAuthenticationConverter#setPrincipalClaimName("user_id"),
//     so auth.getName() returns the Clerk user_id (stable identifier). The
//     email is read separately from the "email" JWT claim; never from getName().
//  8. The BQ-aligned schema has no top-level correlation_id or user_name
//     column. The aspect embeds both inside `attributes` JSON
//     ({"correlation_id": "...", "user_name": "..."}) alongside any
//     caller-supplied UsageAttributes entries.
// Full contract: `.claude/agent_docs/observability/usage-logging-rules.md`.

package com.aidigital.operationalhub.usagelogging;

import com.aidigital.operationalhub.usagelogging.config.UsageLoggingProperties;
import com.aidigital.operationalhub.usagelogging.loggers.UsageLogger;
import com.aidigital.operationalhub.usagelogging.models.UsageEvent;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import jakarta.servlet.http.HttpServletRequest;
import java.lang.reflect.Method;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

/**
 * Captures every public business service-impl call and emits structured usage events.
 */
@Aspect
@Component
@Order(Ordered.LOWEST_PRECEDENCE - 100)   // OUTER than @Transactional (see header)
@ConditionalOnProperty(name = "app.usage-logging.enabled",
                       havingValue = "true",
                       matchIfMissing = true)
public class UsageLoggingAspect {

    private static final Logger LOG = LoggerFactory.getLogger(UsageLoggingAspect.class);

    private static final String EVENT_TYPE_ERROR = "error";
    private static final String STATUS_SUCCESS = "success";
    private static final String STATUS_ERROR = "error";
    private static final String MDC_CORRELATION = "correlationId";
    private static final String ATTR_CORRELATION_ID = "correlation_id";
    private static final String ATTR_USER_NAME = "user_name";
    private static final String DEFAULT_EVENT_TYPE = "api_request";

    /**
     * Auto-intercept every public method of every business service impl
     * ({@code <base>.service.<aggregate>.services.impl.*ServiceImpl}). The
     * package filter deliberately excludes this module's own beans
     * (e.g. {@code UsageEventPersistenceService}), external-services clients,
     * and controllers. Apply {@link LogUsage} only to override the derived
     * action name or event type.
     */
    private static final String SERVICE_IMPL_METHODS =
        "execution(public * *..service..services.impl.*ServiceImpl.*(..))";

    /**
     * The one line that differs from the template, and the reason for it.
     *
     * <p>This repository's business services live in {@code service.<aggregate>.impl} and
     * {@code service.entity.impl} - there is no {@code services} package segment - so
     * {@link #SERVICE_IMPL_METHODS} matches nothing here and the feature would silently
     * record zero rows, the exact failure the template's blanket pointcut exists to prevent.
     * Adding the annotation as a second selector keeps the template's behaviour intact
     * (a project laid out its way still auto-logs) and makes {@link LogUsage} sufficient
     * on its own, which is what PDI_100 asks for: five named user actions, not one row
     * per service call.
     */
    private static final String ANNOTATED_METHODS =
        "@annotation(com.aidigital.operationalhub.usagelogging.LogUsage)";

    /**
     * Claim names checked, in order, when reading the user email from a JWT
     * or OIDC/OAuth2 user. The list covers the names different identity
     * providers commonly use; the first non-blank value wins. IdP-side
     * configuration to surface email under one of these names is out of
     * scope for the template.
     */
    private static final String[] EMAIL_CLAIM_NAMES = {
        "email", "email_address", "primary_email_address", "mail"
    };

    /**
     * Full-name claim aliases. Clerk's templated JWT typically uses
     * {@code full_name} ({@code {{user.full_name}}}); OIDC standard uses
     * {@code name}; {@code preferred_username} is the OIDC fallback when
     * the IdP doesn't ship a display name. When the full-name lookup comes
     * up empty, the aspect falls back to composing
     * {@link #FIRST_NAME_CLAIM_NAMES} + {@link #LAST_NAME_CLAIM_NAMES}
     * (Clerk also exposes these as separate template variables, and OIDC
     * has {@code given_name} / {@code family_name}). The resulting value
     * lands inside the {@code attributes} JSON under {@code user_name}.
     */
    private static final String[] NAME_CLAIM_NAMES = {
        "full_name", "name", "preferred_username"
    };

    private static final String[] FIRST_NAME_CLAIM_NAMES = {
        "first_name", "given_name"
    };

    private static final String[] LAST_NAME_CLAIM_NAMES = {
        "last_name", "family_name"
    };

    private final UsageLogger usageLogger;
    private final UsageLoggingProperties props;
    private final UsageAttributes usageAttributes;

    public UsageLoggingAspect(UsageLogger usageLogger, UsageLoggingProperties props,
                              UsageAttributes usageAttributes) {
        this.usageLogger = usageLogger;
        this.props = props;
        this.usageAttributes = usageAttributes;
    }

    /**
     * Records success or failure metadata around every public service-impl method.
     *
     * @param joinPoint intercepted service method
     * @return original method result
     * @throws Throwable original method failure, always rethrown unchanged
     */
    @Around(SERVICE_IMPL_METHODS + " || " + ANNOTATED_METHODS)
    public Object recordUsage(ProceedingJoinPoint joinPoint) throws Throwable {
        String action = resolveAction(joinPoint);
        String eventType = resolveEventType(joinPoint);
        long startNanos = System.nanoTime();
        Throwable thrown = null;
        try {
            return joinPoint.proceed();
        } catch (Throwable t) {
            thrown = t;
            throw t;                                                 // rethrow — never swallow
        } finally {
            long durationMs = (System.nanoTime() - startNanos) / 1_000_000L;
            try {
                usageLogger.record(buildEvent(action, eventType, thrown, durationMs));
            } catch (Throwable loggingFailure) {
                // Last resort: if even assembling/dispatching the event throws,
                // do NOT propagate into the caller's flow.
                LOG.warn("Usage logging failed for action={}: {}",
                         action, loggingFailure.getMessage());
            } finally {
                // Always clear the per-request attribute bag; otherwise the
                // next request on the same worker thread inherits stale keys.
                usageAttributes.clear();
            }
        }
    }

    /**
     * Resolves the action name: a non-blank {@link LogUsage#action()} override
     * when present, else a derived {@code <aggregate>.<method>}.
     *
     * @param joinPoint intercepted service method
     * @return resolved action name
     */
    String resolveAction(ProceedingJoinPoint joinPoint) {
        LogUsage annotation = findLogUsage(joinPoint);
        if (annotation != null && !annotation.action().isBlank()) {
            return annotation.action();
        }
        return deriveAction(joinPoint);
    }

    /**
     * Resolves the event category: {@link LogUsage#eventType()} when annotated,
     * else the default {@code "api_request"}. A thrown exception still flips the
     * stored event type to error in {@link #buildEvent}.
     *
     * @param joinPoint intercepted service method
     * @return resolved event type
     */
    String resolveEventType(ProceedingJoinPoint joinPoint) {
        LogUsage annotation = findLogUsage(joinPoint);
        return annotation != null ? annotation.eventType() : DEFAULT_EVENT_TYPE;
    }

    /**
     * Reads the optional {@link LogUsage} from the executing impl method, or
     * null when the method is auto-logged without an override.
     *
     * @param joinPoint intercepted service method
     * @return annotation when present, else null
     */
    LogUsage findLogUsage(ProceedingJoinPoint joinPoint) {
        if (joinPoint.getSignature() instanceof MethodSignature signature) {
            Method method = signature.getMethod();
            return method.getAnnotation(LogUsage.class);
        }
        return null;
    }

    /**
     * Derives {@code <aggregate>.<method>} from the impl class + method name
     * when no {@link LogUsage#action()} override is supplied. The class-name
     * suffix ({@code ServiceImpl}/{@code Service}/{@code Impl}) is stripped and
     * the remainder decapitalised: SampleServiceImpl#findById → "sample.findById".
     *
     * @param joinPoint intercepted service method
     * @return derived dotted action name
     */
    String deriveAction(ProceedingJoinPoint joinPoint) {
        String type = joinPoint.getSignature().getDeclaringType().getSimpleName();
        for (String suffix : new String[] {"ServiceImpl", "Service", "Impl"}) {
            if (type.endsWith(suffix) && type.length() > suffix.length()) {
                type = type.substring(0, type.length() - suffix.length());
                break;
            }
        }
        String aggregate = type.isEmpty()
            ? "service"
            : Character.toLowerCase(type.charAt(0)) + type.substring(1);
        return aggregate + "." + joinPoint.getSignature().getName();
    }

    /**
     * Builds the immutable event payload from the invocation context.
     *
     * @param action resolved usage action name
     * @param eventType resolved usage event category
     * @param thrown method failure, or null on success
     * @param durationMs elapsed method duration in milliseconds
     * @return assembled usage event
     */
    UsageEvent buildEvent(String action, String eventType, Throwable thrown, long durationMs) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String userId = (auth != null && auth.isAuthenticated()) ? auth.getName() : null;
        String userEmail = extractEmail(auth);
        boolean failed = thrown != null;
        HttpServletRequest request = currentRequest();

        return UsageEvent.builder()
            .eventId(UUID.randomUUID().toString())
            .eventTimestamp(LocalDateTime.now(ZoneOffset.UTC))
            .service(props.getServiceName())
            .environment(props.getEnvironment())
            .eventType(failed ? EVENT_TYPE_ERROR : eventType)
            .action(action)
            .userId(userId)
            .userEmail(userEmail)
            .status(failed ? STATUS_ERROR : STATUS_SUCCESS)
            .durationMs(durationMs)
            .attributes(buildAttributes(auth))
            .errorMessage(failed ? truncate(thrown.getMessage(), props.getMaxErrorMessageLength()) : null)
            .clientIp(clientIp(request))
            .userAgent(userAgent(request))
            .build();
    }

    /**
     * Merges caller-supplied attributes from {@link UsageAttributes} with the
     * aspect-supplied entries. Today that's the MDC correlation id (the BQ-
     * aligned schema doesn't carry it as a top-level column) and the user's
     * display name lifted out of the JWT/OIDC principal so dashboards can
     * read {@code attributes->>'user_name'} without joining role tables.
     *
     * @param auth current Spring Security authentication (may be null)
     * @return merged map, or null when nothing was contributed
     */
    Map<String, Object> buildAttributes(Authentication auth) {
        Map<String, Object> caller = usageAttributes.snapshot();
        String correlation = MDC.get(MDC_CORRELATION);
        String userName = extractName(auth);
        boolean nothing = caller == null
            && (correlation == null || correlation.isBlank())
            && (userName == null || userName.isBlank());
        if (nothing) {
            return null;
        }
        Map<String, Object> merged = new LinkedHashMap<>();
        if (correlation != null && !correlation.isBlank()) {
            merged.put(ATTR_CORRELATION_ID, correlation);
        }
        if (userName != null && !userName.isBlank()) {
            merged.put(ATTR_USER_NAME, userName);
        }
        if (caller != null) {
            merged.putAll(caller);
        }
        return merged;
    }

    /**
     * Extracts the user email from the Clerk JWT principal.
     *
     * @param auth current Spring Security authentication
     * @return email value, or null when unavailable
     */
    String extractEmail(Authentication auth) {
        return readJwtClaim(auth, EMAIL_CLAIM_NAMES);
    }

    /**
     * Extracts the user's display name from the Clerk JWT.
     *
     * @param auth current Spring Security authentication
     * @return display name, or null when no naming claim is present
     */
    String extractName(Authentication auth) {
        String fullName = readJwtClaim(auth, NAME_CLAIM_NAMES);
        if (fullName != null && !fullName.isBlank()) {
            return fullName;
        }
        String first = readJwtClaim(auth, FIRST_NAME_CLAIM_NAMES);
        String last = readJwtClaim(auth, LAST_NAME_CLAIM_NAMES);
        boolean hasFirst = first != null && !first.isBlank();
        boolean hasLast = last != null && !last.isBlank();
        if (hasFirst && hasLast) {
            return first + " " + last;
        }
        if (hasFirst) {
            return first;
        }
        if (hasLast) {
            return last;
        }
        return null;
    }

    /**
     * Reads the first non-blank claim from a Clerk JWT principal.
     *
     * @param auth current Spring Security authentication
     * @param aliases claim names to try, in order
     * @return first matching value, or null
     */
    String readJwtClaim(Authentication auth, String[] aliases) {
        if (auth == null) {
            return null;
        }
        Object principal = auth.getPrincipal();
        if (!(principal instanceof Jwt jwt)) {
            return null;
        }
        return firstClaim(jwt.getClaims()::get, aliases);
    }

    /**
     * Walks the supplied alias list and returns the first non-blank value the
     * lookup function produces. Tolerant of {@code null} (missing) and
     * blank-string ({@code ""}) claim values.
     *
     * @param lookup function that resolves a claim/attribute name to its value
     * @param aliases claim names to try, in order
     * @return first matching value as a string, or null
     */
    String firstClaim(Function<String, Object> lookup, String[] aliases) {
        for (String name : aliases) {
            Object value = lookup.apply(name);
            if (value == null) {
                continue;
            }
            String s = String.valueOf(value);
            if (!s.isBlank()) {
                return s;
            }
        }
        return null;
    }

    /**
     * Reads the current servlet request from Spring's request context.
     *
     * @return current request, or null outside an HTTP request
     */
    HttpServletRequest currentRequest() {
        var attrs = RequestContextHolder.getRequestAttributes();
        return attrs instanceof ServletRequestAttributes servletAttrs
            ? servletAttrs.getRequest()
            : null;
    }

    /**
     * Resolves the client IP address with proxy support.
     *
     * @param request current HTTP request
     * @return first forwarded IP or remote address, or null without a request
     */
    String clientIp(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            return forwardedFor.split(",", 2)[0].strip();
        }
        return request.getRemoteAddr();
    }

    /**
     * Reads the user-agent header for audit context.
     *
     * @param request current HTTP request
     * @return truncated user-agent value, or null without a request
     */
    String userAgent(HttpServletRequest request) {
        return request == null ? null : truncate(request.getHeader("User-Agent"), props.getMaxUserAgentLength());
    }

    /**
     * Truncates long strings to a safe storage length.
     *
     * @param s input value
     * @param max maximum returned length
     * @return null, unchanged value, or truncated value
     */
    String truncate(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() <= max ? s : s.substring(0, max);
    }
}
