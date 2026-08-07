package com.aidigital.operationalhub.application.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Forwards the frontend's client-side routes to {@code index.html} on a full page load, so a direct
 * navigation or refresh on a deep link (e.g. {@code /agencies/42}) resolves to the SPA shell instead of
 * a 404. Needed now that the frontend uses {@code BrowserRouter} instead of {@code HashRouter}: with
 * hash routing the server only ever saw requests for {@code /}, so no server-side forwarding was
 * required.
 *
 * <p>The forwarded paths mirror the routes declared in {@code AppShell}'s {@code <Routes>}; each one is
 * also listed in {@link SecurityConfig}'s public paths, since the security filter evaluates the
 * original incoming request path, not the forward target.
 */
@Configuration
public class SpaWebConfig implements WebMvcConfigurer {

	@Override
	public void addViewControllers(ViewControllerRegistry registry) {
		registry.addViewController("/agencies").setViewName("forward:/index.html");
		registry.addViewController("/agencies/**").setViewName("forward:/index.html");
		registry.addViewController("/clients/**").setViewName("forward:/index.html");
		registry.addViewController("/campaigns/**").setViewName("forward:/index.html");
		registry.addViewController("/teams").setViewName("forward:/index.html");
	}
}
