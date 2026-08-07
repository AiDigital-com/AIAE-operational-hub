import { describe, expect, it } from "vitest";
import { anInsertionOrderLineItemV1, anInsertionOrderV1 } from "../../test/factories";
import { toSetupModel } from "./setup";

describe("toSetupModel", () => {
  it("should map the reference case - one order, four real line items - onto the Setup tab's model", () => {
    // Given: campaign 46252 / order 276198's real shape
    const io = anInsertionOrderV1({
      order_id: 276198,
      order_number: "SO276198",
      status: "Live",
      start_date: "2026-06-17",
      end_date: "2026-09-17",
      budget: 45000,
      media_tactics: ["CTV/OTT", "YouTube", "Native", "Audio"],
      line_items: [
        anInsertionOrderLineItemV1({ line_item_id: 1001, description: "CTV line", media_tactic: "CTV/OTT", budget: 15000 }),
        anInsertionOrderLineItemV1({ line_item_id: 1002, description: "YouTube line", media_tactic: "YouTube", budget: 10000 }),
        anInsertionOrderLineItemV1({ line_item_id: 1003, description: "Native line", media_tactic: "Native", budget: 10000 }),
        anInsertionOrderLineItemV1({ line_item_id: 1004, description: "Audio line", media_tactic: "Audio", budget: 10000 }),
      ],
    });

    // When:
    const model = toSetupModel([io]);

    // Then:
    expect(model.ios).toHaveLength(1);
    const [order] = model.ios;
    expect(order.id).toBe("276198");
    expect(order.name).toBe("IO SO276198");
    expect(order.budget).toBe(45000);
    expect(order.status).toBe("Live");
    expect(order.channel).toBe("CTV/OTT");
    expect(order.channelMore).toBe(3);
    expect(order.channelExtra).toEqual(["YouTube", "Native", "Audio"]);
    expect(order.lis).toHaveLength(4);
    expect(order.lis.map((li) => li.id)).toEqual(["1001", "1002", "1003", "1004"]);
  });

  it("should show a single media tactic without a +N suffix", () => {
    // Given:
    const io = anInsertionOrderV1({ media_tactics: ["Display"] });

    // When:
    const [order] = toSetupModel([io]).ios;

    // Then:
    expect(order.channel).toBe("Display");
    expect(order.channelMore).toBe(0);
    expect(order.channelExtra).toEqual([]);
  });

  it("should show an em dash when an order has no media tactics", () => {
    // Given:
    const io = anInsertionOrderV1({ media_tactics: [] });

    // When:
    const [order] = toSetupModel([io]).ios;

    // Then:
    expect(order.channel).toBe("—");
    expect(order.channelMore).toBe(0);
  });

  it("should fall back to IO <order_id> when order_number is null", () => {
    // Given:
    const io = anInsertionOrderV1({ order_id: 999, order_number: null });

    // When:
    const [order] = toSetupModel([io]).ios;

    // Then:
    expect(order.name).toBe("IO 999");
  });

  it("should default a null order budget to zero", () => {
    // Given:
    const io = anInsertionOrderV1({ budget: null });

    // When:
    const [order] = toSetupModel([io]).ios;

    // Then:
    expect(order.budget).toBe(0);
  });

  it("should have every line item inherit its order's status - the source has no per-line-item status", () => {
    // Given:
    const io = anInsertionOrderV1({
      status: "Finished",
      line_items: [anInsertionOrderLineItemV1()],
    });

    // When:
    const [order] = toSetupModel([io]).ios;

    // Then:
    expect(order.lis[0].status).toBe("Finished");
  });

  it("should fall back a line item's dates to its order's when its own are null", () => {
    // Given:
    const io = anInsertionOrderV1({
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      line_items: [anInsertionOrderLineItemV1({ start_date: null, end_date: null })],
    });

    // When:
    const [order] = toSetupModel([io]).ios;

    // Then:
    expect(order.lis[0].start).toBe("2026-01-01");
    expect(order.lis[0].end).toBe("2026-12-31");
  });

  it("should default a null line-item budget to zero and name it from its tactic when description is null", () => {
    // Given:
    const io = anInsertionOrderV1({
      line_items: [
        anInsertionOrderLineItemV1({ line_item_id: 5, description: null, media_tactic: "Display", budget: null }),
      ],
    });

    // When:
    const [order] = toSetupModel([io]).ios;

    // Then:
    expect(order.lis[0].budget).toBe(0);
    expect(order.lis[0].name).toBe("Display");
  });

  it("should carry the real rate_type onto the line item, or leave it undefined when null", () => {
    // Given:
    const io = anInsertionOrderV1({
      line_items: [
        anInsertionOrderLineItemV1({ line_item_id: 1, rate_type: "Flat" }),
        anInsertionOrderLineItemV1({ line_item_id: 2, rate_type: null }),
      ],
    });

    // When:
    const [order] = toSetupModel([io]).ios;

    // Then:
    expect(order.lis[0].rateType).toBe("Flat");
    expect(order.lis[1].rateType).toBeUndefined();
  });

  it("should return an empty line-item list when an order has none", () => {
    // Given:
    const io = anInsertionOrderV1({ line_items: [] });

    // When:
    const [order] = toSetupModel([io]).ios;

    // Then:
    expect(order.lis).toEqual([]);
  });
});
