// Added on top of the template's test set, for the one line this module changed: the aspect also selects
// @LogUsage-annotated methods, wherever they live. This repository's services sit in
// service.<aggregate>.impl / service.entity.impl - no `services` segment - so the template's blanket
// *ServiceImpl pointcut matches none of them and the annotation is the only thing that fires. If this test
// ever fails, the five PDI_100 events stop being recorded silently, which is the failure mode worth a test.
package com.aidigital.operationalhub.usagelogging;

import com.aidigital.operationalhub.usagelogging.config.UsageLoggingProperties;
import com.aidigital.operationalhub.usagelogging.loggers.UsageLogger;
import com.aidigital.operationalhub.usagelogging.models.UsageEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

@SpringJUnitConfig(UsageLoggingAnnotationPointcutTest.TestConfig.class)
class UsageLoggingAnnotationPointcutTest {

    /** A bean in a package the blanket *ServiceImpl pointcut cannot match, like this repo's own services. */
    static class CampaignWorkspaceBean {

        @LogUsage(action = "report.create")
        public String createReport() {
            return "created";
        }

        public String listReports() {
            return "listed";
        }
    }

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
            props.setServiceName("operational-hub");
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
        CampaignWorkspaceBean campaignWorkspaceBean() {
            return new CampaignWorkspaceBean();
        }
    }

    @Autowired
    private UsageLogger usageLogger;

    @Autowired
    private CampaignWorkspaceBean bean;

    @BeforeEach
    void resetSink() {
        // The sink bean lives in the shared Spring context, as in the template's own aspect test.
        reset(usageLogger);
    }

    @Test
    void shouldRecordAnAnnotatedMethodOutsideTheServiceImplPackagesTest() {
        // When:
        String result = bean.createReport();

        // Then:
        assertThat(result).isEqualTo("created");
        ArgumentCaptor<UsageEvent> captor = ArgumentCaptor.forClass(UsageEvent.class);
        verify(usageLogger).record(captor.capture());
        UsageEvent event = captor.getValue();
        assertThat(event.action()).isEqualTo("report.create");
        assertThat(event.eventType()).isEqualTo("api_request");
        assertThat(event.status()).isEqualTo("success");
        assertThat(event.service()).isEqualTo("operational-hub");
    }

    @Test
    void shouldLeaveUnannotatedMethodsOutsideThosePackagesAloneTest() {
        // When: the same bean's un-annotated method is called.
        bean.listReports();

        // Then: usage logging stays a deliberate list of actions, not a log of every call.
        verifyNoInteractions(usageLogger);
    }
}
