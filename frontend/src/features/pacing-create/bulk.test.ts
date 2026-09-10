import { describe, expect, it } from "vitest";
import { BULK_FIELDS, GAP_FILTERS, coerceValue, matchTable, viewOrder, type BulkViewRow } from "./bulk";

describe("coerceValue", () => {
  it("tolerates spreadsheet-pasted number formats", () => {
    expect(coerceValue("num", "70%")).toEqual({ ok: true, value: "70" });
    expect(coerceValue("num", "1,5")).toEqual({ ok: true, value: "1.5" });
    expect(coerceValue("num", "1,234")).toEqual({ ok: true, value: "1234" });
    expect(coerceValue("num", "1,234.5")).toEqual({ ok: true, value: "1234.5" });
    expect(coerceValue("num", "1 234")).toEqual({ ok: true, value: "1234" });
    expect(coerceValue("num", "1 234")).toEqual({ ok: true, value: "1234" });
    expect(coerceValue("int", "1234.6")).toEqual({ ok: true, value: "1235" });
  });

  it("rejects unparseable or empty input", () => {
    expect(coerceValue("num", "abc").ok).toBe(false);
    expect(coerceValue("num", "").ok).toBe(false);
  });

  it("accepts YYYY-MM-DD and DD.MM.YYYY dates, rejects anything else", () => {
    expect(coerceValue("date", "2026-08-01")).toEqual({ ok: true, value: "2026-08-01" });
    expect(coerceValue("date", "1.8.2026")).toEqual({ ok: true, value: "2026-08-01" });
    expect(coerceValue("date", "08/01/2026").ok).toBe(false);
  });
});

describe("matchTable", () => {
  const rows = [{ lineItemId: "615953" }, { lineItemId: "615954" }, { lineItemId: "615955" }];

  it("matches a header-driven paste table by line item id, last row wins per field", () => {
    const text = [
      "LI ID\tVCR\tMargin %\tNonsense",
      "615953\t70%\t25\tx",
      "615954\t\t30\ty", // blank VCR cell = skip, not error
      "999999\t50\t20\tz", // unknown id
      "615955\tabc\t\t", // invalid VCR, blank margin
      "615953\t71\t\t", // same LI again -> last wins for VCR
    ].join("\n");
    const r = matchTable(text, rows);
    expect(r.error).toBeUndefined();
    expect(r.skippedHeaders).toEqual(["Nonsense"]);
    expect(r.notFound).toEqual(["999999"]);
    const byField = Object.fromEntries((r.columns ?? []).map((c) => [c.field, c]));
    expect(byField.targetVcr.set).toBe(1);
    expect(byField.targetVcr.invalid).toBe(1);
    expect(byField.marginPercent.set).toBe(2);
    const upd = Object.fromEntries((r.updates ?? []).map((u) => [`${u.index}:${u.field}`, u.value]));
    expect(upd["0:targetVcr"]).toBe("71");
    expect(upd["0:marginPercent"]).toBe("25");
    expect(upd["1:marginPercent"]).toBe("30");
    expect(upd["2:targetVcr"]).toBeUndefined();
  });

  it("reports header/shape errors without throwing", () => {
    const one = [{ lineItemId: "1" }];
    expect(matchTable("", one).error).toBe("empty");
    expect(matchTable("justoneword", one).error).toMatch(/header row/);
    expect(matchTable("ID\tFoo\n1\t2", one).error).toMatch(/no recognized/);
  });

  it("matches header aliases case/spacing-insensitively and coerces on the way in", () => {
    const one = [{ lineItemId: "1" }];
    const ok = matchTable("anything\tmp budget\tstart\n1\t1 000\t1.8.2026", one);
    expect(ok.error).toBeUndefined();
    const upd = Object.fromEntries((ok.updates ?? []).map((u) => [u.field, u.value]));
    expect(upd.nativeBudget).toBe("1000");
    expect(upd.flightStart).toBe("2026-08-01");
  });
});

describe("GAP_FILTERS + viewOrder", () => {
  function row(overrides: Partial<BulkViewRow>): BulkViewRow {
    return {
      lineItemId: "0",
      channel: "Display",
      rateType: "CPM",
      flightStart: "2026-01-01",
      flightEnd: "2026-02-01",
      marginPercent: "25",
      targetImpressions: "1",
      nativeBudget: "1",
      targetCtr: "",
      targetVcr: "",
      ...overrides,
    };
  }

  const rows: BulkViewRow[] = [
    row({ lineItemId: "3", channel: "Video", targetVcr: "" }),
    row({ lineItemId: "1", channel: "Display", targetVcr: "70", marginPercent: "" }),
    row({ lineItemId: "2", channel: "Video", targetVcr: "" }),
  ];

  it("viewOrder with no options returns identity order", () => {
    expect(viewOrder(rows, {})).toEqual([0, 1, 2]);
  });

  it("gap filters select real indexes of rows missing that field", () => {
    expect(viewOrder(rows, { gapFilter: "vcr" })).toEqual([0, 2]);
    expect(viewOrder(rows, { gapFilter: "required" })).toEqual([1]);
  });

  it("sorts stably by the given key/direction, returning real indexes", () => {
    expect(viewOrder(rows, { sortKey: "lineItemId", sortDir: "asc" })).toEqual([1, 2, 0]);
    expect(viewOrder(rows, { sortKey: "lineItemId", sortDir: "desc" })).toEqual([0, 2, 1]);
    expect(viewOrder(rows, { sortKey: "channel", sortDir: "asc" })).toEqual([1, 0, 2]); // stable: 0 before 2
  });

  it("registry sanity: every bulk field has a real kind, GAP_FILTERS.all accepts anything", () => {
    for (const f of BULK_FIELDS) expect(["num", "int", "date"]).toContain(f.kind);
    expect(GAP_FILTERS.all.test(row({}))).toBe(true);
  });
});
