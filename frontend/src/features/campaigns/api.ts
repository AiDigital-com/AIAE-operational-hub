import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type {
  CampaignSearchRequestV1,
  ConversionAdjustmentRequestV1,
  ConversionBreakdownRequestV1,
  ConversionRowSearchRequestV1,
  ReportRowAdjustmentsRequestV1,
  ReportRowFilterFieldEnumV1,
  ReportRowSearchRequestV1,
  ReportViewUpsertV1,
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

/**
 * A download's bytes, plus whether the server had to cut the row list short at the export cap.
 *
 * The flag travels in a header because the body is the file itself, and it cannot be dropped on the
 * floor: a truncated workbook still carries the report's full-dataset totals, so its rows and its
 * totals disagree by design. Silently handing that to someone reconciling numbers is the worst
 * outcome available.
 *
 * @param result the raw openapi-fetch result
 * @returns the file and its truncation flag
 */
function requireFile(result: ApiResult<Blob>) {
  return {
    blob: requireData(result),
    truncated: result.response.headers.get("X-Report-Truncated") === "true",
  };
}

// A 204 response has no body, so this can't require result.data the way requireData does.
function requireOk(result: ApiResult<unknown>) {
  if (result.error || !result.response.ok) {
    throw new Error(formatError(result.error));
  }
}

export async function searchCampaigns(pageNumber: number, pageSize: number, body: CampaignSearchRequestV1) {
  return requireData(await apiClient.POST("/api/v1/campaigns/search", {
    params: { query: { pageNumber, pageSize } },
    body,
  }));
}

export async function getCampaign(campaignId: number) {
  return requireData(await apiClient.GET("/api/v1/campaigns/{campaignId}", {
    params: { path: { campaignId } },
  }));
}

export async function listCampaignReportRows(
  campaignId: number,
  pageNumber: number,
  pageSize: number,
  body: ReportRowSearchRequestV1
) {
  return requireData(await apiClient.POST("/api/v1/campaigns/{campaignId}/report-rows", {
    params: { path: { campaignId }, query: { pageNumber, pageSize } },
    body,
  }));
}

export async function listReportRowDistinctValues(campaignId: number, field: ReportRowFilterFieldEnumV1) {
  return requireData(
    await apiClient.GET("/api/v1/campaigns/{campaignId}/report-rows/distinct-values", {
      params: { path: { campaignId }, query: { field } },
    })
  );
}

export async function saveReportRowAdjustments(campaignId: number, body: ReportRowAdjustmentsRequestV1) {
  requireOk(
    await apiClient.POST("/api/v1/campaigns/{campaignId}/report-rows/adjustments", {
      params: { path: { campaignId } },
      body,
    })
  );
}

export async function exportReportRows(campaignId: number, body: ReportRowSearchRequestV1) {
  return requireFile(
    await apiClient.POST("/api/v1/campaigns/{campaignId}/report-rows/export", {
      params: { path: { campaignId } },
      body,
      parseAs: "blob",
    })
  );
}

export async function downloadBulkAdjustmentTemplate(campaignId: number, body: ReportRowSearchRequestV1) {
  return requireFile(
    await apiClient.POST("/api/v1/campaigns/{campaignId}/report-rows/adjustments/template", {
      params: { path: { campaignId } },
      body,
      parseAs: "blob",
    })
  );
}

export async function uploadBulkAdjustments(campaignId: number, file: File) {
  return requireData(
    await apiClient.POST("/api/v1/campaigns/{campaignId}/report-rows/adjustments/upload", {
      params: { path: { campaignId } },
      // openapi-typescript types a `format: binary` field as `string`; the body is really `{ file: File }`
      // at runtime, and this bodySerializer sends it as FormData, keeping the call inside the shared
      // openapi-fetch client (no raw fetch).
      body: { file } as unknown as { file: string },
      bodySerializer(payload: { file: string }) {
        const form = new FormData();
        form.append("file", payload.file as unknown as File);
        return form;
      },
    })
  );
}

export async function downloadConversionAdjustmentTemplate(
  campaignId: number,
  body: ConversionRowSearchRequestV1
) {
  return requireFile(
    await apiClient.POST("/api/v1/campaigns/{campaignId}/conversions/adjustments/template", {
      params: { path: { campaignId } },
      body,
      parseAs: "blob",
    })
  );
}

export async function uploadConversionAdjustments(campaignId: number, file: File) {
  return requireData(
    await apiClient.POST("/api/v1/campaigns/{campaignId}/conversions/adjustments/upload", {
      params: { path: { campaignId } },
      // Same binary-field workaround as uploadBulkAdjustments above.
      body: { file } as unknown as { file: string },
      bodySerializer(payload: { file: string }) {
        const form = new FormData();
        form.append("file", payload.file as unknown as File);
        return form;
      },
    })
  );
}

/** The conversions rows behind one report row's Conversions cell, one per conversion action. */
export async function listConversionBreakdown(
  campaignId: number,
  body: ConversionBreakdownRequestV1
) {
  return requireData(
    await apiClient.POST("/api/v1/campaigns/{campaignId}/conversions/breakdown", {
      params: { path: { campaignId } },
      body,
    })
  );
}

/** Applies conversions edited in place, through the same write the spreadsheet upload uses. */
export async function applyConversionAdjustments(
  campaignId: number,
  body: ConversionAdjustmentRequestV1
) {
  return requireData(
    await apiClient.POST("/api/v1/campaigns/{campaignId}/conversions/adjustments", {
      params: { path: { campaignId } },
      body,
    })
  );
}

export async function listCampaignInsertionOrders(campaignId: number) {
  return requireData(
    await apiClient.GET("/api/v1/campaigns/{campaignId}/insertion-orders", {
      params: { path: { campaignId } },
    })
  );
}

export async function listReportViews(campaignId: number, pageNumber: number, pageSize: number) {
  return requireData(
    await apiClient.GET("/api/v1/campaigns/{campaignId}/report-views", {
      params: { path: { campaignId }, query: { pageNumber, pageSize } },
    })
  );
}

export async function createReportView(campaignId: number, body: ReportViewUpsertV1) {
  return requireData(
    await apiClient.POST("/api/v1/campaigns/{campaignId}/report-views", {
      params: { path: { campaignId } },
      body,
    })
  );
}

export async function updateReportView(campaignId: number, viewId: number, body: ReportViewUpsertV1) {
  return requireData(
    await apiClient.PUT("/api/v1/campaigns/{campaignId}/report-views/{viewId}", {
      params: { path: { campaignId, viewId } },
      body,
    })
  );
}

export async function deleteReportView(campaignId: number, viewId: number) {
  requireOk(
    await apiClient.DELETE("/api/v1/campaigns/{campaignId}/report-views/{viewId}", {
      params: { path: { campaignId, viewId } },
    })
  );
}

export async function duplicateReportView(campaignId: number, viewId: number) {
  return requireData(
    await apiClient.POST("/api/v1/campaigns/{campaignId}/report-views/{viewId}/duplicate", {
      params: { path: { campaignId, viewId } },
    })
  );
}
