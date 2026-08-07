import type { InsertionOrder, LineItem, SetupModel } from "../pacing/mock/types";
import type { InsertionOrderLineItemV1, InsertionOrderV1 } from "./types";

/**
 * Adapts the real `/insertion-orders` response into the `SetupModel` shape the Setup tab already
 * renders (previously produced by the mock's `buildSetup`). Replaces the mock for this tab only - the
 * mock Pacing/Overview path still calls `buildSetup` directly (see 01-MIGRATION-PLAN.md's follow-up
 * plan §D10).
 *
 * A line item has no status of its own in the source data - it inherits its parent order's (see
 * InsertionOrderV1's own description).
 *
 * @param ios the real insertion orders
 * @return the Setup tab's model
 */
export function toSetupModel(ios: InsertionOrderV1[]): SetupModel {
  return { ios: ios.map(toInsertionOrder) };
}

function channelLabel(
  mediaTactics: string[] | undefined
): { channel: string; channelMore: number; channelExtra: string[] } {
  const tactics = mediaTactics ?? [];
  if (tactics.length === 0) return { channel: "—", channelMore: 0, channelExtra: [] };
  return { channel: tactics[0], channelMore: Math.max(0, tactics.length - 1), channelExtra: tactics.slice(1) };
}

function minDate(dates: string[]): string {
  return dates.reduce((min, date) => (min === "" || date < min ? date : min), "");
}

function maxDate(dates: string[]): string {
  return dates.reduce((max, date) => (date > max ? date : max), "");
}

function toInsertionOrder(io: InsertionOrderV1): InsertionOrder {
  const orderId = String(io.order_id);
  const status = io.status ?? "";
  const { channel, channelMore, channelExtra } = channelLabel(io.media_tactics);
  const lineItemDates = (io.line_items ?? []).flatMap((li) => [li.start_date, li.end_date].filter(Boolean) as string[]);
  const start = io.start_date ?? minDate(lineItemDates);
  const end = io.end_date ?? maxDate(lineItemDates);
  const lis: LineItem[] = (io.line_items ?? []).map((li) => toLineItem(li, status, channel, start, end));
  return {
    id: orderId,
    name: `IO ${io.order_number ?? io.order_id}`,
    channel,
    channelMore,
    channelExtra,
    start,
    end,
    budget: io.budget ?? 0,
    status,
    lis,
    manual: false,
    open: true,
  };
}

function toLineItem(
  li: InsertionOrderLineItemV1,
  ioStatus: string,
  ioChannel: string,
  ioStart: string,
  ioEnd: string
): LineItem {
  return {
    id: String(li.line_item_id),
    name: li.description ?? li.media_tactic ?? `Line item ${li.line_item_id}`,
    channel: li.media_tactic ?? ioChannel,
    rateType: li.rate_type ?? undefined,
    start: li.start_date ?? ioStart,
    end: li.end_date ?? ioEnd,
    budget: li.budget ?? 0,
    status: ioStatus,
    manual: false,
  };
}
