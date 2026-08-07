package com.aidigital.operationalhub.usagelogging;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link UsageAttributes}.
 */
class UsageAttributesTest {

    private UsageAttributes usageAttributes;

    @BeforeEach
    void setUp() {
        usageAttributes = new UsageAttributes();
    }

    @AfterEach
    void tearDown() {
        usageAttributes.clear();
    }

    @Test
    void shouldAccumulateAndSnapshotAttributesTest() {
        // When:
        usageAttributes.put("geo", "US");
        usageAttributes.put("count", 3);

        // Then:
        Map<String, Object> snapshot = usageAttributes.snapshot();
        assertThat(snapshot).containsEntry("geo", "US").containsEntry("count", 3);
    }

    @Test
    void shouldIgnoreNullKeyOrValueTest() {
        // When:
        usageAttributes.put(null, "x");
        usageAttributes.put("k", null);

        // Then: nothing was recorded
        assertThat(usageAttributes.snapshot()).isNull();
    }

    @Test
    void shouldReturnNullSnapshotWhenEmptyAndAfterClearTest() {
        // Then: empty bag snapshots null
        assertThat(usageAttributes.snapshot()).isNull();

        // When: a value is recorded then cleared
        usageAttributes.put("a", "b");
        usageAttributes.clear();

        // Then:
        assertThat(usageAttributes.snapshot()).isNull();
    }
}
