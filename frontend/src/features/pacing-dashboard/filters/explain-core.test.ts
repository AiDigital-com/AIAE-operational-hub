/**
 * The explanation panel's core, ported with the reference's own cases
 * (`tests/filter-spotlight-core-test.mjs`: activeItems, rangeRow, countsFor, panelFor, value
 * groups) - adapted to this file's input shapes (`channel` for `ch`, a flat `factsDaily`).
 */
import { describe, expect, it } from "vitest";
import {
  activeItems,
  buildFilterSources,
  countsFor,
  DOWNGRADE_NOTE,
  groupMembersLine,
  MISSING_NOTE,
  panelFor,
  RANGE_SENTENCE,
  rangeRow,
  TIER_SENTENCES,
  type SpotlightLiPlan,
} from "./spotlight-core";
import { DEFAULT_FILTERS } from "./types";
import type { FactRow } from "../journal/fact-dims";

const PLAN: Record<string, SpotlightLiPlan> = {
  "100": {
    channel: "Video",
    labels: ["priority"],
    description: "Hero video",
    containers: [
      { target_impressions: 1000, dim_children: [{ dim_key: "geo", dim_value: "TX", target_mode: "absolute", target_value: 400 }] },
    ],
  },
  "200": { channel: "Video", labels: [] },
  "300": { channel: "Display", labels: ["priority"] },
};
const FACTS: FactRow[] = [
  { line_item_id: 100, platform: "TTD", geo: "TX", audience: "Lookalike" },
  { line_item_id: 200, platform: "TTD", geo: "NY", audience: "Lookalike" },
  { line_item_id: 300, platform: "dv_360_dlv", geo: "TX", audience: "" },
  { line_item_id: 300, platform: "dv_360_dlv", geo: "TX", audience: "-" },
];
const SOURCES = buildFilterSources({ liPlan: PLAN, factsDaily: FACTS });
const COUNTS = countsFor(SOURCES, { liPlan: PLAN, factsDaily: FACTS });
const source = (type: string, value: string) => SOURCES.find((s) => s.type === type && s.value === value)!;

describe("countsFor", () => {
  it("counts the lines each filter touches", () => {
    expect(COUNTS.get("channel:Video")).toBe(2);
    expect(COUNTS.get("channel:Display")).toBe(1);
    expect(COUNTS.get("label:priority")).toBe(2);
    expect(COUNTS.get("platform:TTD")).toBe(2);
    expect(COUNTS.get("platform:dv_360_dlv")).toBe(1); // two rows, one line
    expect(COUNTS.get("audience:Lookalike")).toBe(2);
    expect(COUNTS.has("li:100")).toBe(false);
  });

  it("counts a Scope dim value by the lines carrying the split, with the delivery count beside it", () => {
    expect(COUNTS.get("geo:TX")).toBe(1);
    expect(COUNTS.get("delivery:geo:TX")).toBe(2);
    expect(COUNTS.get("geo:NY")).toBe(1);
  });
});

describe("panelFor", () => {
  it("names a line item by its name, id and channel", () => {
    expect(panelFor(source("li", "100"), { displayedTier: "scope", counts: COUNTS, liPlan: PLAN })).toEqual({
      title: "Hero video · LI 100 · Video",
      sentence: TIER_SENTENCES.scope,
      note: null,
    });
    expect(panelFor(source("li", "200"), { displayedTier: "scope", counts: COUNTS, liPlan: PLAN }).title).toBe("LI 200 · Video");
  });

  it("says how many lines a channel, a platform or a dim value touches", () => {
    expect(panelFor(source("channel", "Display"), { displayedTier: "scope", counts: COUNTS })).toEqual({
      title: "1 line",
      sentence: TIER_SENTENCES.scope,
      note: null,
    });
    expect(panelFor(source("platform", "TTD"), { displayedTier: "lens", counts: COUNTS })).toEqual({
      title: "2 lines have delivery here",
      sentence: TIER_SENTENCES.lens,
      note: null,
    });
    expect(panelFor(source("geo", "TX"), { displayedTier: "scope", counts: COUNTS })).toEqual({
      title: "1 line carries a split for this value",
      sentence: TIER_SENTENCES.scope,
      note: null,
    });
  });

  it("a split-backed value shown as Lens reads its delivery count and the downgrade note", () => {
    expect(panelFor({ ...source("geo", "TX"), hasSplit: true }, { displayedTier: "lens", counts: COUNTS })).toEqual({
      title: "2 lines have delivery here",
      sentence: TIER_SENTENCES.lens,
      note: DOWNGRADE_NOTE,
    });
  });

  it("explains the range and a filter with nothing behind it", () => {
    expect(panelFor(rangeRow({ range: "7", customRange: { from: "", to: "" } })!, {})).toEqual({
      title: "Last 7 days",
      sentence: RANGE_SENTENCE,
      note: null,
    });
    expect(panelFor({ type: "geo", value: "CA", label: "geo: CA" }, { displayedTier: "lens", missing: true }).note).toBe(MISSING_NOTE);
  });
});

describe("rangeRow", () => {
  it("is null with no range, labels a quick range in days", () => {
    expect(rangeRow({ range: "all", customRange: { from: "", to: "" } })).toBeNull();
    expect(rangeRow({ range: "custom", customRange: { from: "", to: "" } })).toBeNull();
    expect(rangeRow({ range: "1", customRange: { from: "", to: "" } })!.title).toBe("Last day");
    expect(rangeRow({ range: "custom", customRange: { from: "2026-09-01", to: "2026-09-10" } })!.title).toContain("–");
  });
});

describe("activeItems", () => {
  const filters = {
    ...DEFAULT_FILTERS,
    selection: ["100", "999"],
    channels: ["Video"],
    labels: ["priority"],
    platforms: ["TTD"],
    brkf: ["geo:TX", "geo:NY"],
    range: "7",
  };

  it("orders Scope rows, the range last among them, then Lens rows - the board's answer decides a cut's tier", () => {
    const rows = activeItems(filters, SOURCES, { brkf: ["geo:TX"] });

    expect(rows.map((r) => r.key)).toEqual([
      "li:100", "li:999", "channel:Video", "label:priority", "geo:TX", "range", "platform:TTD", "geo:NY",
    ]);
    expect(rows.map((r) => r.tier)).toEqual(["scope", "scope", "scope", "scope", "scope", "scope", "lens", "lens"]);
  });

  it("labels rows and keeps a filter with no source as a missing row", () => {
    const rows = activeItems(filters, SOURCES, { brkf: ["geo:TX"] });

    expect(rows.find((r) => r.key === "li:100")!.label).toBe("Hero video");
    expect(rows.find((r) => r.key === "li:999")).toMatchObject({ label: "LI 999", missing: true });
    expect(rows.find((r) => r.key === "geo:NY")!.label).toBe("geo: NY");
    expect(rows.find((r) => r.key === "platform:TTD")!.label).toBe("The Trade Desk");
  });

  it("a cut the period has no plan for is Lens, and still remembers it has a split", () => {
    const [row] = activeItems({ ...DEFAULT_FILTERS, brkf: ["geo:TX"] }, SOURCES, { brkf: [] });

    expect(row).toMatchObject({ tier: "lens", hasSplit: true });
  });
});

describe("value groups in the panel", () => {
  const BRAND = { dim_key: "keyword", name: "Brand", values: ["PMax_Brand", "Search_Brand"] };
  const item = { type: "keyword", value: "Brand", label: "Brand", tier: "scope" as const };
  const one: Record<string, SpotlightLiPlan> = { "100": { dimGroups: [BRAND] }, "200": { dimGroups: [] }, "300": {} };

  it("says which values a group stands for, and where", () => {
    expect(groupMembersLine(item, one)).toBe("Brand = PMax_Brand, Search_Brand on LI 100");
    expect(groupMembersLine(item, { "100": { dimGroups: [BRAND] }, "200": { dimGroups: [{ ...BRAND, values: ["search_brand", "PMAX_BRAND"] }] } }))
      .toBe("Brand = PMax_Brand, Search_Brand on 2 lines");
    expect(groupMembersLine(item, { "100": { dimGroups: [BRAND] }, "200": { dimGroups: [{ ...BRAND, values: ["YouTube_Brand"] }] }, "300": { dimGroups: [BRAND] } }))
      .toBe("Brand is a value group on 3 lines, with different values");
    expect(groupMembersLine(item, { "100": { dimGroups: [{ ...BRAND, values: ["a", "b", "c", "d", "e", "f", "g", "h"] }] } }))
      .toBe("Brand = a, b, c, d, e, f +2 more on LI 100");
  });

  it("answers null for anything that is not a group", () => {
    expect(groupMembersLine({ ...item, value: "brand" }, one)).toBeNull(); // another spelling is another value
    expect(groupMembersLine({ ...item, value: "PMax_Brand" }, one)).toBeNull(); // a member is not a group
    expect(groupMembersLine({ ...item, type: "geo" }, one)).toBeNull();
    expect(groupMembersLine({ type: "channel", value: "Brand" }, one)).toBeNull();
    expect(groupMembersLine(item, null)).toBeNull();
  });

  it("adds the line to a dim value's panel only", () => {
    const counts = new Map([["keyword:Brand", 1], ["delivery:keyword:Brand", 2]]);
    expect(panelFor(item, { displayedTier: "scope", counts, liPlan: one })).toEqual({
      title: "1 line carries a split for this value",
      sentence: TIER_SENTENCES.scope,
      note: null,
      members: "Brand = PMax_Brand, Search_Brand on LI 100",
    });
    expect("members" in panelFor({ ...item, value: "Other" }, { displayedTier: "lens", counts, liPlan: one })).toBe(false);
    expect("members" in panelFor(item, { displayedTier: "scope", liPlan: one, missing: true })).toBe(false);
  });
});
