import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The apiClient singleton is built from runtimeConfig.apiBaseUrl at import time, and
 * jsdom's Request cannot resolve a relative URL. Each test therefore stubs an absolute
 * base url and imports a fresh runtime + client pair so requests are parseable, then
 * spies on the same freshly-imported runtime instance the client closes over.
 *
 * openapi-fetch captures globalThis.fetch when the client is created, so the fetch spy
 * must already be installed before this import runs.
 */
async function loadClientWithAbsoluteBaseUrl() {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "http://localhost");
  const runtimeModule = await import("../config/runtime");
  const clientModule = await import("./client");
  return { runtimeConfig: runtimeModule.runtimeConfig, apiClient: clientModule.apiClient };
}

describe("apiClient request interceptor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("should attach a bearer authorization header when a token is available", async () => {
    // Given: a stubbed fetch installed before the client captures it, and a runtime token
    const token = "jwt-abc-123";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }));
    const { runtimeConfig, apiClient } = await loadClientWithAbsoluteBaseUrl();
    const tokenSpy = vi.spyOn(runtimeConfig, "getAuthToken").mockResolvedValue(token);

    // When: any request is issued through the client
    await apiClient.GET("/api/v1/auth/me");

    // Then: the token getter is consulted and the captured request carries the bearer header
    expect(tokenSpy).toHaveBeenCalledTimes(1);
    const capturedRequest = fetchSpy.mock.calls[0][0] as Request;
    expect(capturedRequest.headers.get("Authorization")).toBe(`Bearer ${token}`);
  });

  it("should not attach an authorization header when no token is available", async () => {
    // Given: a stubbed fetch installed before the client captures it, and no runtime token
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }));
    const { runtimeConfig, apiClient } = await loadClientWithAbsoluteBaseUrl();
    vi.spyOn(runtimeConfig, "getAuthToken").mockResolvedValue(null);

    // When: any request is issued through the client
    await apiClient.GET("/api/v1/auth/me");

    // Then: the captured request has no authorization header
    const capturedRequest = fetchSpy.mock.calls[0][0] as Request;
    expect(capturedRequest.headers.get("Authorization")).toBeNull();
  });
});

describe("apiClient response interceptor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("should invoke the unauthorized handler on a 401 response", async () => {
    // Given: a stubbed fetch returning 401 installed before the client captures it
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    const { runtimeConfig, apiClient } = await loadClientWithAbsoluteBaseUrl();
    vi.spyOn(runtimeConfig, "getAuthToken").mockResolvedValue(null);
    const unauthorizedSpy = vi.spyOn(runtimeConfig, "onUnauthorized").mockResolvedValue();

    // When: a request receives a 401 response
    await apiClient.GET("/api/v1/auth/me");

    // Then: the unauthorized handler is invoked once
    expect(unauthorizedSpy).toHaveBeenCalledTimes(1);
  });

  it("should not invoke the unauthorized handler on a successful response", async () => {
    // Given: a stubbed fetch returning 200 installed before the client captures it
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })
    );
    const { runtimeConfig, apiClient } = await loadClientWithAbsoluteBaseUrl();
    vi.spyOn(runtimeConfig, "getAuthToken").mockResolvedValue(null);
    const unauthorizedSpy = vi.spyOn(runtimeConfig, "onUnauthorized").mockResolvedValue();

    // When: a request receives a successful response
    await apiClient.GET("/api/v1/auth/me");

    // Then: the unauthorized handler is never invoked
    expect(unauthorizedSpy).not.toHaveBeenCalled();
  });
});
