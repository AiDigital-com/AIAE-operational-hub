import { describe, expect, it, vi } from "vitest";
import { apiClient } from "../../shared/api/client";
import {
  aHubUserSummaryV1,
  aRoleAssignmentV1,
  aRoleV1,
  aScopeTypeV1,
  aUserV1,
  anAssignRoleRequestV1,
} from "@/test/factories";
import { assignRole, getCurrentUser, listRoleAssignments, listRoles, listScopeTypes, revokeRole, searchUsers } from "./api";

const GENERIC_ERROR = "Something went wrong. Please try again.";

type GetResult = Awaited<ReturnType<typeof apiClient.GET>>;
type PostResult = Awaited<ReturnType<typeof apiClient.POST>>;
type DeleteResult = Awaited<ReturnType<typeof apiClient.DELETE>>;

describe("getCurrentUser", () => {
  it("should return the user payload when the request succeeds", async () => {
    // Given: a successful GET response carrying the current user
    const expectedUser = aUserV1({ roles: ["ADMIN"] });
    const getSpy = vi.spyOn(apiClient, "GET");
    getSpy.mockResolvedValue({
      data: expectedUser,
      response: new Response(null, { status: 200 }),
    } as unknown as GetResult);

    // When: the current user is loaded
    const result = await getCurrentUser();

    // Then: the user is returned and the auth/me path is requested
    expect(result).toBe(expectedUser);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy.mock.calls[0][0]).toBe("/api/v1/auth/me");
  });

  it("should throw the backend human-readable message without exposing the code or status", async () => {
    // Given: a GET response with a backend error body (code + message) and a 500 status
    const getSpy = vi.spyOn(apiClient, "GET");
    getSpy.mockResolvedValue({
      error: { code: "OPH_000", message: "boom", timestamp: "2026-06-16T00:00:00Z", correlationId: "abc" },
      response: new Response(null, { status: 500, statusText: "Server Error" }),
    } as unknown as GetResult);

    // When: the current user is loaded
    // Then: only the human-readable message surfaces (no code, status, or JSON)
    await expect(getCurrentUser()).rejects.toThrow("boom");
    await expect(getCurrentUser()).rejects.not.toThrow(/OPH_000|500|correlationId/);
  });

  it("should throw a generic message when the error body is empty", async () => {
    // Given: a non-ok GET response with no error body
    const getSpy = vi.spyOn(apiClient, "GET");
    getSpy.mockResolvedValue({
      response: new Response(null, { status: 404, statusText: "Not Found" }),
    } as unknown as GetResult);

    // When: the current user is loaded
    // Then: a generic human-readable message is shown
    await expect(getCurrentUser()).rejects.toThrow(GENERIC_ERROR);
  });

  it("should throw a generic message when the response is ok but data is missing", async () => {
    // Given: an ok GET response with no data
    const getSpy = vi.spyOn(apiClient, "GET");
    getSpy.mockResolvedValue({
      response: new Response(null, { status: 200, statusText: "" }),
    } as unknown as GetResult);

    // When: the current user is loaded
    // Then: a generic human-readable message is shown
    await expect(getCurrentUser()).rejects.toThrow(GENERIC_ERROR);
  });
});

describe("listRoles", () => {
  it("should return roles from the dictionary endpoint", async () => {
    // Given: a successful response with a list of roles
    const expectedRoles = [aRoleV1(), aRoleV1({ future: true })];
    const getSpy = vi.spyOn(apiClient, "GET");
    getSpy.mockResolvedValue({
      data: expectedRoles,
      response: new Response(null, { status: 200 }),
    } as unknown as GetResult);

    // When: roles are listed
    const result = await listRoles();

    // Then: the roles are returned and the roles dictionary path is requested
    expect(result).toBe(expectedRoles);
    expect(getSpy.mock.calls[0][0]).toBe("/api/v1/dictionary/rbac/roles");
  });
});

describe("listScopeTypes", () => {
  it("should return scope types from the dictionary endpoint", async () => {
    // Given: a successful response with a list of scope types
    const expectedScopes = [aScopeTypeV1()];
    const getSpy = vi.spyOn(apiClient, "GET");
    getSpy.mockResolvedValue({
      data: expectedScopes,
      response: new Response(null, { status: 200 }),
    } as unknown as GetResult);

    // When: scope types are listed
    const result = await listScopeTypes();

    // Then: the scope types are returned and the scope-types path is requested
    expect(result).toBe(expectedScopes);
    expect(getSpy.mock.calls[0][0]).toBe("/api/v1/dictionary/rbac/scope-types");
  });
});

describe("searchUsers", () => {
  it("should post the paging params and search body and return the page", async () => {
    // Given: a successful POST response carrying a page of user summaries
    const expectedPage = {
      content: [aHubUserSummaryV1(), aHubUserSummaryV1({ role_code: undefined })],
      pageNumber: 2,
      pageSize: 20,
      totalElements: 42,
      totalPages: 3,
    };
    const body = {
      filters: [{ field: "FULL_NAME" as const, value: "jane", operation: "CONTAINS" as const, caseSensitive: false }],
      sorting: { field: "EMAIL" as const, direction: "DESC" as const },
    };
    const postSpy = vi.spyOn(apiClient, "POST");
    postSpy.mockResolvedValue({
      data: expectedPage,
      response: new Response(null, { status: 200 }),
    } as unknown as PostResult);

    // When: users are searched on page 2
    const result = await searchUsers(2, 20, body);

    // Then: the page is returned and the search path, paging query, and body are captured
    expect(result).toBe(expectedPage);
    expect(postSpy.mock.calls[0][0]).toBe("/api/v1/rbac/users/search");
    const capturedOptions = postSpy.mock.calls[0][1] as {
      params: { query: { pageNumber: number; pageSize: number } };
      body: typeof body;
    };
    expect(capturedOptions.params.query).toEqual({ pageNumber: 2, pageSize: 20 });
    expect(capturedOptions.body).toBe(body);
  });

  it("should throw the backend validation message without exposing field codes", async () => {
    // Given: a POST response carrying a validation error body
    const postSpy = vi.spyOn(apiClient, "POST");
    postSpy.mockResolvedValue({
      error: {
        errors: [{ code: "OPH_017", field: "pageSize", error: "must be at most 100" }],
        timestamp: "2026-06-16T00:00:00Z",
        correlationId: "abc",
      },
      response: new Response(null, { status: 400, statusText: "Bad Request" }),
    } as unknown as PostResult);

    // When: users are searched
    // Then: the readable validation text surfaces without the code
    await expect(searchUsers(1, 20, {})).rejects.toThrow("must be at most 100");
    await expect(searchUsers(1, 20, {})).rejects.not.toThrow(/OPH_017/);
  });
});

describe("listRoleAssignments", () => {
  it("should request assignments for the given user id", async () => {
    // Given: a successful response with assignments and a target user id
    const userId = 4242;
    const expectedAssignments = [aRoleAssignmentV1({ user_id: userId })];
    const getSpy = vi.spyOn(apiClient, "GET");
    getSpy.mockResolvedValue({
      data: expectedAssignments,
      response: new Response(null, { status: 200 }),
    } as unknown as GetResult);

    // When: assignments are listed for the user
    const result = await listRoleAssignments(userId);

    // Then: assignments are returned and the user id is threaded into the path params
    expect(result).toBe(expectedAssignments);
    expect(getSpy.mock.calls[0][0]).toBe("/api/v1/rbac/users/{userId}/role-assignments");
    const capturedOptions = getSpy.mock.calls[0][1] as { params: { path: { userId: number } } };
    expect(capturedOptions.params.path.userId).toBe(userId);
  });
});

describe("assignRole", () => {
  it("should post the assignment body and path params and return created assignment", async () => {
    // Given: a successful POST response and an assignment request
    const userId = 777;
    const requestBody = anAssignRoleRequestV1({ role_code: "ADMIN", scope_code: "ALL", scope_id: undefined });
    const createdAssignment = aRoleAssignmentV1({ user_id: userId, role_code: "ADMIN", scope_code: "ALL" });
    const postSpy = vi.spyOn(apiClient, "POST");
    postSpy.mockResolvedValue({
      data: createdAssignment,
      response: new Response(null, { status: 201 }),
    } as unknown as PostResult);

    // When: the role is assigned
    const result = await assignRole(userId, requestBody);

    // Then: the created assignment is returned and the captured request matches the inputs
    expect(result).toBe(createdAssignment);
    expect(postSpy.mock.calls[0][0]).toBe("/api/v1/rbac/users/{userId}/role-assignments");
    const capturedOptions = postSpy.mock.calls[0][1] as {
      params: { path: { userId: number } };
      body: typeof requestBody;
    };
    expect(capturedOptions.params.path.userId).toBe(userId);
    expect(capturedOptions.body).toBe(requestBody);
  });

  it("should throw the backend message verbatim when assignment fails with a string error", async () => {
    // Given: a POST response with a string error and a conflict status
    const postSpy = vi.spyOn(apiClient, "POST");
    postSpy.mockResolvedValue({
      error: "role already assigned",
      response: new Response(null, { status: 409, statusText: "Conflict" }),
    } as unknown as PostResult);

    // When: the role is assigned
    // Then: only the human-readable detail surfaces (no status)
    await expect(assignRole(1, anAssignRoleRequestV1())).rejects.toThrow("role already assigned");
    await expect(assignRole(1, anAssignRoleRequestV1())).rejects.not.toThrow(/409/);
  });
});

describe("revokeRole", () => {
  it("should delete the assignment by user and assignment id without returning a body", async () => {
    // Given: a successful no-content DELETE response
    const userId = 12;
    const assignmentId = 99;
    const deleteSpy = vi.spyOn(apiClient, "DELETE");
    deleteSpy.mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as unknown as DeleteResult);

    // When: the assignment is revoked
    const result = await revokeRole(userId, assignmentId);

    // Then: nothing is returned and the captured path params match the inputs
    expect(result).toBeUndefined();
    expect(deleteSpy.mock.calls[0][0]).toBe("/api/v1/rbac/users/{userId}/role-assignments/{assignmentId}");
    const capturedOptions = deleteSpy.mock.calls[0][1] as {
      params: { path: { userId: number; assignmentId: number } };
    };
    expect(capturedOptions.params.path.userId).toBe(userId);
    expect(capturedOptions.params.path.assignmentId).toBe(assignmentId);
  });

  it("should throw a generic message when revoke responds with a non-ok status and no body", async () => {
    // Given: a DELETE response that is not ok and carries no error body
    const deleteSpy = vi.spyOn(apiClient, "DELETE");
    deleteSpy.mockResolvedValue({
      response: new Response(null, { status: 403, statusText: "Forbidden" }),
    } as unknown as DeleteResult);

    // When: the assignment is revoked
    // Then: a generic human-readable message is shown
    await expect(revokeRole(1, 2)).rejects.toThrow(GENERIC_ERROR);
  });
});
