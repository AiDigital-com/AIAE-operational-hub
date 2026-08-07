import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../shared/api/client";
import { anAgencyPageV1 } from "@/test/factories";
import { searchAgencies } from "./api";

type PostResult = Awaited<ReturnType<typeof apiClient.POST>>;

describe("searchAgencies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should post the paging params and search body and return the agency page", async () => {
    // Given: a successful POST response carrying a BigQuery-backed agency page
    const expectedPage = anAgencyPageV1({ pageNumber: 1, pageSize: 20, totalElements: 1, totalPages: 1 });
    const body = { sorting: { field: "NAME" as const, direction: "ASC" as const } };
    const postSpy = vi.spyOn(apiClient, "POST");
    postSpy.mockResolvedValue({
      data: expectedPage,
      response: new Response(null, { status: 200 }),
    } as unknown as PostResult);

    // When: agencies are searched on page 1
    const result = await searchAgencies(1, 20, body);

    // Then: the page is returned and the search path, paging query, and body are captured
    expect(result).toBe(expectedPage);
    expect(postSpy.mock.calls[0][0]).toBe("/api/v1/agencies/search");
    const capturedOptions = postSpy.mock.calls[0][1] as {
      params: { query: { pageNumber: number; pageSize: number } };
      body: typeof body;
    };
    expect(capturedOptions.params.query).toEqual({ pageNumber: 1, pageSize: 20 });
    expect(capturedOptions.body).toBe(body);
  });

  it("should throw the formatted backend message when the request fails", async () => {
    // Given: a failed POST response from the agencies endpoint
    const postSpy = vi.spyOn(apiClient, "POST");
    postSpy.mockResolvedValue({
      error: { code: "OPH_018", message: "BigQuery data query failed." },
      response: new Response(null, { status: 500, statusText: "Internal Server Error" }),
    } as unknown as PostResult);

    // When: agencies are searched
    // Then: the readable backend message is surfaced
    await expect(searchAgencies(1, 20, {})).rejects.toThrow("BigQuery data query failed.");
  });
});
