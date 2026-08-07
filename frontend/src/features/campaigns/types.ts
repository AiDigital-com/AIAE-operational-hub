import type { components } from "../../shared/api/generated/schema";

export type CampaignV1 = components["schemas"]["CampaignV1"];
export type ReportRowV1 = components["schemas"]["ReportRowV1"];
export type ReportRowTotalsV1 = components["schemas"]["ReportRowTotalsV1"];
export type ReportRowsPageResponseV1 = components["schemas"]["ReportRowsPageResponseV1"];
export type CampaignSearchRequestV1 = components["schemas"]["CampaignSearchRequestV1"];
export type CampaignPageResponseV1 = components["schemas"]["CampaignPageResponseV1"];
export type CampaignSortFieldEnumV1 = components["schemas"]["CampaignSortFieldEnumV1"];
export type CampaignFilterFieldEnumV1 = components["schemas"]["CampaignFilterFieldEnumV1"];
export type DirectionEnumV1 = components["schemas"]["DirectionEnumV1"];
export type FilterOperationEnumV1 = components["schemas"]["FilterOperationEnumV1"];
export type ReportRowSortFieldEnumV1 = components["schemas"]["ReportRowSortFieldEnumV1"];
export type ReportRowFilterFieldEnumV1 = components["schemas"]["ReportRowFilterFieldEnumV1"];
export type ReportRowFilterV1 = components["schemas"]["ReportRowFilterV1"];
export type ReportRowSearchRequestV1 = components["schemas"]["ReportRowSearchRequestV1"];
export type ConversionRowSearchRequestV1 = components["schemas"]["ConversionRowSearchRequestV1"];
export type ConversionBreakdownRequestV1 = components["schemas"]["ConversionBreakdownRequestV1"];
export type ConversionBreakdownV1 = components["schemas"]["ConversionBreakdownV1"];
export type ConversionBreakdownRowV1 = components["schemas"]["ConversionBreakdownRowV1"];
export type ConversionAdjustmentRequestV1 = components["schemas"]["ConversionAdjustmentRequestV1"];
export type ConversionAdjustmentRowV1 = components["schemas"]["ConversionAdjustmentRowV1"];
export type ReportRowAdjustmentV1 = components["schemas"]["ReportRowAdjustmentV1"];
export type ReportRowAdjustmentsRequestV1 = components["schemas"]["ReportRowAdjustmentsRequestV1"];
export type ReportRowBulkAdjustmentResultV1 = components["schemas"]["ReportRowBulkAdjustmentResultV1"];
export type ReportViewV1 = components["schemas"]["ReportViewV1"];
export type ReportViewPageResponseV1 = components["schemas"]["ReportViewPageResponseV1"];
export type ReportViewUpsertV1 = components["schemas"]["ReportViewUpsertV1"];
export type InsertionOrderV1 = components["schemas"]["InsertionOrderV1"];
export type InsertionOrderLineItemV1 = components["schemas"]["InsertionOrderLineItemV1"];

/** Which dimensions, metrics, and active row filters a report view persists. */
export interface ReportConfig {
  dimensions: string[];
  metrics: string[];
  filters: ReportRowFilterV1[];
}

/** A saved (or draft) report view — the client-facing shape the Reporting tab consumes. */
export interface ReportView {
  id: string;
  name: string;
  type: "basic";
  status: "draft" | "saved";
  note?: string;
  created: string;
  edited: string | null;
  config: ReportConfig;
}
