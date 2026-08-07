import { ApiError } from "../../shared/api/api-error";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type { AssignRoleRequestV1, HubUserSearchRequestV1 } from "./types";

interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function requireData<T>(result: ApiResult<T>) {
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

function requireOk(result: ApiResult<unknown>) {
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}

export async function getCurrentUser() {
  return requireData(await apiClient.GET("/api/v1/auth/me"));
}

export async function listRoles() {
  return requireData(await apiClient.GET("/api/v1/dictionary/rbac/roles"));
}

export async function listScopeTypes() {
  return requireData(await apiClient.GET("/api/v1/dictionary/rbac/scope-types"));
}

export async function listStatuses() {
  return requireData(await apiClient.GET("/api/v1/dictionary/statuses"));
}

export async function searchUsers(pageNumber: number, pageSize: number, body: HubUserSearchRequestV1) {
  return requireData(await apiClient.POST("/api/v1/rbac/users/search", {
    params: { query: { pageNumber, pageSize } },
    body,
  }));
}

export async function listRoleAssignments(userId: number) {
  return requireData(await apiClient.GET("/api/v1/rbac/users/{userId}/role-assignments", {
    params: { path: { userId } },
  }));
}

export async function assignRole(userId: number, body: AssignRoleRequestV1) {
  return requireData(await apiClient.POST("/api/v1/rbac/users/{userId}/role-assignments", {
    params: { path: { userId } },
    body,
  }));
}

export async function revokeRole(userId: number, assignmentId: number) {
  requireOk(await apiClient.DELETE("/api/v1/rbac/users/{userId}/role-assignments/{assignmentId}", {
    params: { path: { userId, assignmentId } },
  }));
}
