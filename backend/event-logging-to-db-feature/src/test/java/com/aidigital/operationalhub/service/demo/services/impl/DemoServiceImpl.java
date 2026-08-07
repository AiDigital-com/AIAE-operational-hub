// Test-only service impl placed in a package that matches the auto-log
// pointcut (*..service..services.impl.*ServiceImpl). Used by
// UsageLoggingAspectTest to prove the aspect fires with NO annotation — the
// behaviour that previously silently broke when methods were left un-annotated.
package com.aidigital.operationalhub.service.demo.services.impl;

import com.aidigital.operationalhub.usagelogging.LogUsage;

public class DemoServiceImpl {

    public String doThing() {
        return "ok";
    }

    public void boom() {
        throw new IllegalStateException("kaboom");
    }

    @LogUsage(action = "custom.action.name")
    public String custom() {
        return "ok";
    }
}
