import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type {
  CreateTeamRequestV1,
  SyncSummaryV1,
  TeamPageResponseV1,
  TeamSearchRequestV1,
  TeamV1,
  UpdateTeamRequestV1,
} from "./types";

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

export async function listTeams(): Promise<TeamV1[]> {
  return requireData(await apiClient.GET("/api/v1/teams"));
}

export async function searchTeams(
  pageNumber: number,
  pageSize: number,
  body: TeamSearchRequestV1
): Promise<TeamPageResponseV1> {
  return requireData(await apiClient.POST("/api/v1/teams/search", {
    params: { query: { pageNumber, pageSize } },
    body,
  }));
}

export async function createTeam(body: CreateTeamRequestV1): Promise<TeamV1> {
  return requireData(await apiClient.POST("/api/v1/teams", { body }));
}

export async function updateTeam(teamId: number, body: UpdateTeamRequestV1): Promise<TeamV1> {
  return requireData(await apiClient.PUT("/api/v1/teams/{teamId}", {
    params: { path: { teamId } },
    body,
  }));
}

export async function syncNetSuite(): Promise<SyncSummaryV1> {
  return requireData(await apiClient.POST("/api/v1/sync"));
}
