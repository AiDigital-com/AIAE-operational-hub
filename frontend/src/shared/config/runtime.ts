interface RuntimeConfig {
  apiBaseUrl: string;
  clerkPublishableKey: string;
  clerkJwtTemplate: string;
  validate(): void;
  getAuthToken(): Promise<string | null>;
  onUnauthorized(): Promise<void>;
}

const env = import.meta.env;

const cfg = {
  apiBaseUrl: resolveApiBaseUrl(
    (env.VITE_API_BASE_URL ?? "").toString(),
    (env.VITE_API_CONTEXT_PATH ?? "").toString()
  ),
  clerkPublishableKey: (env.VITE_CLERK_PUBLISHABLE_KEY ?? "").toString(),
  clerkJwtTemplate: (env.VITE_CLERK_JWT_TEMPLATE ?? "aidigital-api").toString(),
};

let ssoTokenGetter: (() => Promise<string | null>) | null = null;

export const runtimeConfig: RuntimeConfig = {
  ...cfg,

  validate() {
    if (!cfg.clerkPublishableKey) {
      throw new Error("Clerk SSO is required: set VITE_CLERK_PUBLISHABLE_KEY");
    }
    if (!cfg.clerkJwtTemplate) {
      throw new Error("Clerk JWT template is required: set VITE_CLERK_JWT_TEMPLATE");
    }
  },

  async getAuthToken() {
    return ssoTokenGetter ? await ssoTokenGetter() : null;
  },

  async onUnauthorized() {
    // Clerk owns session state, so there is no local token to clear here.
  },
};

export function setSsoTokenGetter(getter: (() => Promise<string | null>) | null) {
  ssoTokenGetter = getter;
}

export function resolveApiBaseUrl(explicitBaseUrl?: string, contextPath?: string): string {
  const explicit = stripTrailingSlash(explicitBaseUrl?.trim() ?? "");
  if (explicit) return rejectApiVersionPrefix(explicit);

  const context = stripTrailingSlash(contextPath?.trim() ?? "");
  if (context) return rejectApiVersionPrefix(context);

  return "";
}

function rejectApiVersionPrefix(value: string): string {
  if (value === "/api/v1" || value.endsWith("/api/v1")) {
    throw new Error("VITE_API_BASE_URL must not include /api/v1 because OpenAPI paths already include it");
  }
  return value;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
