import { useAuth } from "@clerk/clerk-react";
import { useEffect, useState } from "react";
import { runtimeConfig, setSsoTokenGetter } from "../config/runtime";
import { formatError } from "../format/error";

export interface SsoTokenState {
  ready: boolean;
  error: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
}

/**
 * Resolves the Clerk template JWT and registers it with the shared API client so every
 * authenticated query carries a Bearer token. Returns the readiness/error state used to gate
 * server-backed UI.
 */
export function useSsoToken(): SsoTokenState {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!isLoaded || !isSignedIn) {
      setReady(false);
      setError(null);
      setSsoTokenGetter(null);
      return undefined;
    }

    setReady(false);
    setError(null);

    getToken({ template: runtimeConfig.clerkJwtTemplate })
      .then((token) => {
        if (cancelled) return;
        if (!token) {
          setSsoTokenGetter(null);
          setError(`Clerk did not return JWT template ${runtimeConfig.clerkJwtTemplate}`);
          return;
        }
        setSsoTokenGetter(() => getToken({ template: runtimeConfig.clerkJwtTemplate }));
        setReady(true);
      })
      .catch((tokenError: unknown) => {
        if (cancelled) return;
        setSsoTokenGetter(null);
        setError(formatError(tokenError));
      });

    return () => {
      cancelled = true;
      setReady(false);
      setSsoTokenGetter(null);
    };
  }, [getToken, isLoaded, isSignedIn]);

  return { ready, error, isLoaded, isSignedIn: Boolean(isSignedIn) };
}
