import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveApiBaseUrl, runtimeConfig, setSsoTokenGetter } from "./runtime";

describe("resolveApiBaseUrl", () => {
  it("should return explicit base url stripped of trailing slash", () => {
    // Given: an explicit base url with a trailing slash and an unrelated context path
    const explicitBaseUrl = "https://hub.example.com/";
    const contextPath = "/ignored";

    // When: the api base url is resolved
    const resolved = resolveApiBaseUrl(explicitBaseUrl, contextPath);

    // Then: the explicit url wins and the trailing slash is removed
    expect(resolved).toBe("https://hub.example.com");
  });

  it("should fall back to context path when explicit base url is blank", () => {
    // Given: a blank explicit base url and a context path with a trailing slash
    const explicitBaseUrl = "   ";
    const contextPath = "/hub/";

    // When: the api base url is resolved
    const resolved = resolveApiBaseUrl(explicitBaseUrl, contextPath);

    // Then: the context path is used without its trailing slash
    expect(resolved).toBe("/hub");
  });

  it("should return empty string when both inputs are blank", () => {
    // Given: blank explicit base url and blank context path
    const explicitBaseUrl = "";
    const contextPath = "  ";

    // When: the api base url is resolved
    const resolved = resolveApiBaseUrl(explicitBaseUrl, contextPath);

    // Then: an empty base url is returned
    expect(resolved).toBe("");
  });

  it("should default missing arguments to an empty base url", () => {
    // Given: no arguments at all
    // When: the api base url is resolved
    const resolved = resolveApiBaseUrl();

    // Then: an empty base url is returned
    expect(resolved).toBe("");
  });

  it("should reject an explicit base url that ends with the api version prefix", () => {
    // Given: an explicit base url that already includes /api/v1
    const explicitBaseUrl = "https://hub.example.com/api/v1";

    // When: the api base url is resolved
    // Then: resolution throws because the OpenAPI paths already include /api/v1
    expect(() => resolveApiBaseUrl(explicitBaseUrl)).toThrow(/must not include \/api\/v1/);
  });

  it("should reject a context path equal to the api version prefix", () => {
    // Given: a blank explicit base url and a context path equal to /api/v1
    const explicitBaseUrl = "";
    const contextPath = "/api/v1";

    // When: the api base url is resolved
    // Then: resolution throws for the version prefix
    expect(() => resolveApiBaseUrl(explicitBaseUrl, contextPath)).toThrow(/must not include \/api\/v1/);
  });
});

describe("runtimeConfig.getAuthToken", () => {
  afterEach(() => {
    setSsoTokenGetter(null);
  });

  it("should return null when no sso token getter is registered", async () => {
    // Given: no registered sso token getter
    setSsoTokenGetter(null);

    // When: the auth token is requested
    const token = await runtimeConfig.getAuthToken();

    // Then: null is returned and nothing is invoked
    expect(token).toBeNull();
  });

  it("should delegate to the registered sso token getter exactly once", async () => {
    // Given: a registered sso token getter producing a token
    const expectedToken = "jwt-token-value";
    const getter = vi.fn<() => Promise<string | null>>().mockResolvedValue(expectedToken);
    setSsoTokenGetter(getter);

    // When: the auth token is requested
    const token = await runtimeConfig.getAuthToken();

    // Then: the getter result is returned and the getter is called once with no arguments
    expect(token).toBe(expectedToken);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(getter.mock.calls[0]).toEqual([]);
  });
});

describe("runtimeConfig.onUnauthorized", () => {
  it("should resolve without throwing because clerk owns session state", async () => {
    // Given: the shared runtime config
    // When: the unauthorized handler runs
    const result = await runtimeConfig.onUnauthorized();

    // Then: it resolves to undefined
    expect(result).toBeUndefined();
  });
});

describe("runtimeConfig.validate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadRuntimeWithEnv(env: Record<string, string>) {
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    return import("./runtime");
  }

  it("should throw when the clerk publishable key is missing", async () => {
    // Given: a runtime config loaded without a publishable key
    const module = await loadRuntimeWithEnv({
      VITE_CLERK_PUBLISHABLE_KEY: "",
      VITE_CLERK_JWT_TEMPLATE: "aidigital-api",
    });

    // When: validation runs
    // Then: it throws demanding the publishable key
    expect(() => module.runtimeConfig.validate()).toThrow(/VITE_CLERK_PUBLISHABLE_KEY/);
  });

  it("should throw when the clerk jwt template is empty", async () => {
    // Given: a runtime config with a key but an explicitly empty jwt template
    const module = await loadRuntimeWithEnv({
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_value",
      VITE_CLERK_JWT_TEMPLATE: "",
    });

    // When: validation runs
    // Then: it throws demanding the jwt template
    expect(() => module.runtimeConfig.validate()).toThrow(/VITE_CLERK_JWT_TEMPLATE/);
  });

  it("should pass validation when both clerk settings are present", async () => {
    // Given: a runtime config with both clerk settings provided
    const module = await loadRuntimeWithEnv({
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_value",
      VITE_CLERK_JWT_TEMPLATE: "aidigital-api",
    });

    // When: validation runs
    // Then: no error is thrown
    expect(() => module.runtimeConfig.validate()).not.toThrow();
  });
});
