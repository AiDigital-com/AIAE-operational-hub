import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type { AgencyPageResponseV1, AgencySearchRequestV1 } from "./types";

interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function requireData<T>(result: ApiResult<T>) {
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new Error(formatError(result.error));
  }
  return result.data;
}

export async function searchAgencies(
  pageNumber: number,
  pageSize: number,
  body: AgencySearchRequestV1
): Promise<AgencyPageResponseV1> {
  return requireData(await apiClient.POST("/api/v1/agencies/search", {
    params: { query: { pageNumber, pageSize } },
    body,
  }));
}
