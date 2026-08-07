// UsageAttributes — request-scoped key/value bag for the per-row `attributes`
// JSON column. Business code inside an @LogUsage method calls
// `usageAttributes.put("geo", request.geo())`; the aspect drains the bag in
// its finally{} block, embeds the map into UsageEvent.attributes, and clears
// the ThreadLocal. Lives in the event-logging-to-db-feature module so
// service-impl classes can import it without depending on application/.
//
// Contract:
//  - Inject this bean into services that need to annotate events.
//  - Sync calls only. ThreadLocal does NOT propagate to @Async worker
//    threads — if the annotated method is @Async, apply
//    DelegatingSecurityContextRunnable and forward the snapshot explicitly.
//  - Never PII: emails of third parties, raw doc bodies, API keys, JWTs.
//    See observability/usage-logging-rules.md → "Sensitive data".
//  - Values must be JSON-serialisable (String, Number, Boolean, Map, List).
//    Hibernate's @JdbcTypeCode(SqlTypes.JSON) maps via Jackson.

package com.aidigital.operationalhub.usagelogging;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Injectable per-request attribute bag drained by {@link UsageLoggingAspect}
 * into the {@code attributes} JSON column.
 *
 * <p>Inject this bean into services that need to attach structured metadata to
 * the in-flight usage event:
 * <pre>{@code
 * private final UsageAttributes usageAttributes;
 *
 * public void doSomething(...) {
 *     usageAttributes.put("document_id", doc.getId());
 * }
 * }</pre>
 */
@Component
public class UsageAttributes {

    private final ThreadLocal<Map<String, Object>> bag = new ThreadLocal<>();

    /**
     * Records one attribute on the in-flight event. Subsequent calls with the
     * same key overwrite. Silently ignores null keys and null values.
     *
     * @param key   attribute key (alphanumeric / underscore preferred)
     * @param value JSON-serialisable value
     */
    public void put(String key, Object value) {
        if (key == null || value == null) {
            return;
        }
        Map<String, Object> map = bag.get();
        if (map == null) {
            map = new LinkedHashMap<>();
            bag.set(map);
        }
        map.put(key, value);
    }

    /**
     * Returns the accumulated attributes for the current thread without
     * clearing them. Aspect-only usage path.
     *
     * @return immutable snapshot, or null when no attributes were recorded
     */
    public Map<String, Object> snapshot() {
        Map<String, Object> map = bag.get();
        return (map == null || map.isEmpty()) ? null : Map.copyOf(map);
    }

    /**
     * Discards the attribute bag for the current thread. The aspect calls this
     * in {@code finally\{\}} after the event is dispatched so the next request
     * on the same worker thread starts clean.
     */
    public void clear() {
        bag.remove();
    }
}
