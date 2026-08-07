package com.aidigital.operationalhub.usagelogging.entities;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class UsageEventEntityTest {

    @Test
    void distinctTransientEntitiesAreNotEqualTest() {
        UsageEventEntity a = new UsageEventEntity();
        UsageEventEntity b = new UsageEventEntity();

        assertThat(a).isNotEqualTo(b);
    }

    @Test
    void sameTransientInstanceEqualsItselfTest() {
        UsageEventEntity a = new UsageEventEntity();

        assertThat(a).isEqualTo(a);
    }

    @Test
    void persistedEntitiesWithSameIdAreEqualTest() {
        UsageEventEntity a = new UsageEventEntity();
        a.setId(42L);
        UsageEventEntity b = new UsageEventEntity();
        b.setId(42L);

        assertThat(a).isEqualTo(b);
        assertThat(a).hasSameHashCodeAs(b);
    }

    @Test
    void persistedEntitiesWithDifferentIdsAreNotEqualTest() {
        UsageEventEntity a = new UsageEventEntity();
        a.setId(1L);
        UsageEventEntity b = new UsageEventEntity();
        b.setId(2L);

        assertThat(a).isNotEqualTo(b);
    }

    @Test
    void hashCodeIsDerivedFromIdWhenPresentTest() {
        UsageEventEntity a = new UsageEventEntity();
        a.setId(99L);

        assertThat(a.hashCode()).isEqualTo(Long.valueOf(99L).hashCode());
    }

    @Test
    void transientHashCodeIsZeroTest() {
        assertThat(new UsageEventEntity().hashCode()).isZero();
    }
}
