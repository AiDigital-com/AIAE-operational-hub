// @LogUsage — OPTIONAL override for the auto usage-logging aspect.
//
// UsageLoggingAspect already records EVERY public *ServiceImpl method to
// usage_events with no annotation needed (action derived from class+method).
// Add @LogUsage only to override the derived action name or the event type
// on a specific method. The aspect captures action, user, status, duration,
// and writes a UsageEvent row via UsageLogger.
//
// !!! Self-invocation does NOT trigger the aspect !!!
// Spring AOP works via proxies. `this.annotatedMethod()` inside the same
// class bypasses the proxy. Always call the annotated method from another
// Spring bean (controller → service.update(...) — works; service.foo()
// calls this.bar() in the same class — bar's aspect does NOT fire).
//
// Don't log secrets: the aspect logs `action` + `eventType` + user +
// duration + status. It does NOT serialise method arguments. If you need
// to record a domain-specific attribute, call UsageLogger directly inside
// the method body for that one detail.

package com.aidigital.operationalhub.usagelogging;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface LogUsage {

    /**
     * Dotted lowercase action name, e.g. "employee.update", "report.export".
     * OPTIONAL — when blank the aspect derives {@code <aggregate>.<method>}
     * from the impl class + method. Set it only to override that default.
     * Becomes UsageEvent.action.
     *
     * @return usage action name override, or "" to use the derived name
     */
    String action() default "";

    /**
     * Event category. Defaults to "api_request". Other values: "auth",
     * "custom". Errors are inferred automatically when the method throws.
     *
     * @return usage event category
     */
    String eventType() default "api_request";
}
