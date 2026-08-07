import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type { ClientPageResponseV1, ClientSearchRequestV1 } from "./types";

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

export async function searchClients(
  pageNumber: number,
  pageSize: number,
  body: ClientSearchRequestV1
): Promise<ClientPageResponseV1> {
  return requireData(await apiClient.POST("/api/v1/clients/search", {
    params: { query: { pageNumber, pageSize } },
    body,
  }));
}
