package com.aidigital.operationalhub.application.config;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryKindV1;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.format.FormatterRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Locale;

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
 *
 * <p>Also the one place MVC interceptors are registered, which today is
 * {@link BigQueryOperationInterceptor} - a second {@code WebMvcConfigurer} would only split that list.
 *
 * <p>And the one place a query-string enum learns its wire spelling. Spring's default String-to-enum
 * conversion matches the Java constant NAME ({@code LAYOUT}), while the contract's value - what the
 * frontend sends - is lowercase ({@code ?kind=layout}), so every filtered library read answered 400.
 */
@Configuration
@RequiredArgsConstructor
public class SpaWebConfig implements WebMvcConfigurer {

	private final BigQueryOperationInterceptor bigQueryOperationInterceptor;

	@Override
	public void addFormatters(FormatterRegistry registry) {
		registry.addConverter(String.class, PacingLibraryKindV1.class,
				source -> PacingLibraryKindV1.fromValue(source.trim().toLowerCase(Locale.ROOT)));
	}

	@Override
	public void addInterceptors(InterceptorRegistry registry) {
		registry.addInterceptor(bigQueryOperationInterceptor);
	}

	@Override
	public void addViewControllers(ViewControllerRegistry registry) {
		registry.addViewController("/agencies").setViewName("forward:/index.html");
		registry.addViewController("/agencies/**").setViewName("forward:/index.html");
		registry.addViewController("/clients/**").setViewName("forward:/index.html");
		registry.addViewController("/campaigns/**").setViewName("forward:/index.html");
		registry.addViewController("/teams").setViewName("forward:/index.html");
	}
}
