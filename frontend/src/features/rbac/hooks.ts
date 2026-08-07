import { useQuery } from "@tanstack/react-query";
import type { UserV1 } from "./types";
import { getCurrentUser } from "./api";

export const ADMIN_ROLE_CODE = "ADMIN";

/**
 * Loads the authenticated Hub user. Enable only once the SSO token is ready so the request
 * carries a Bearer token.
 */
export function useCurrentUser(enabled: boolean) {
  return useQuery({ queryKey: ["auth", "me"], queryFn: getCurrentUser, enabled });
}

/**
 * True when the user holds the ADMIN role and may manage RBAC.
 */
export function isAdminUser(user: UserV1 | undefined): boolean {
  return Boolean(user?.roles?.includes(ADMIN_ROLE_CODE));
}
