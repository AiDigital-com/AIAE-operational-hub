import { describe, expect, it } from "vitest";
// @ts-expect-error - moved SPA module, plain JS with no types of its own
import { buildLineJoin, lineJoinDims } from "./line-join.js";

/**
 * Which CM360 belongs to which line item (`docs/2026-09-29-cm360-by-line.md`).
 *
 * The CM360 export carries no line item at all, so the link is the mapping's own groups: a group
 * of join-dimension values plus a month. The rules worth pinning are the ones that decide whether
 * a number is attributed, split, or deliberately withheld - an attribution this code gets wrong is
 * a figure a person reads as fact.
 *
 * Fixtures are written here rather than taken from the reference: its captures are anonymised
 * production data, and a test should say in its own fixture what it is testing.
 */

type Cells = Record<string, Record<string, string | null>>;

/** The smallest dataset `buildLineJoin` reads: one join dimension, two sides, daily rows. */
function dataset(opts: {
  deliveryRows: { key: string; liId: string }[];
  deliveryCells: Cells;
  cm360Cells: Cells;
  deliveryDaily: Record<string, unknown>[];
  cm360Daily: Record<string, unknown>[];
  dims?: Record<string, unknown>[];
  perDim?: Record<string, unknown>[];
}) {
  return {
    dims: opts.dims ?? [{ id: "d1", name: "Format" }],
    classified: {
      perDim: opts.perDim ?? [{ dimId: "d1", dCount: 1, dTotal: 1, cCount: 1, cTotal: 1 }],
      deliveryCells: opts.deliveryCells,
      cm360Cells: opts.cm360Cells,
    },
    activeDeliveryRows: opts.deliveryRows,
    deliveryDaily: opts.deliveryDaily,
    cm360Daily: opts.cm360Daily,
  };
}

const day = (key: string, date: string, impressions: number) => ({ key, date, impressions });

describe("which dimensions the join groups by", () => {
  it("keeps only dimensions that classify BOTH sides", () => {
    // A dimension one side never gets cannot tell CM360 rows apart by line; keeping it would
    // leave every CM360 row unclassified and attribute nothing at all.
    const ds = dataset({
      deliveryRows: [], deliveryCells: {}, cm360Cells: {}, deliveryDaily: [], cm360Daily: [],
      dims: [{ id: "both" }, { id: "deliveryOnly" }, { id: "neither" }],
      perDim: [
        { dimId: "both", dCount: 2, cCount: 3 },
        { dimId: "deliveryOnly", dCount: 2, cCount: 0 },
        { dimId: "neither", dCount: 0, cCount: 0 },
      ],
    });
    expect(lineJoinDims(ds).map((d: { id: string }) => d.id)).toEqual(["both"]);
  });

  it("never groups by Month - every row has one, so it tells nothing apart", () => {
    const ds = dataset({
      deliveryRows: [], deliveryCells: {}, cm360Cells: {}, deliveryDaily: [], cm360Daily: [],
      dims: [{ id: "m", auto_kind: "month" }, { id: "d1" }],
      perDim: [{ dimId: "m", dCount: 9, cCount: 9 }, { dimId: "d1", dCount: 1, cCount: 1 }],
    });
    expect(lineJoinDims(ds).map((d: { id: string }) => d.id)).toEqual(["d1"]);
  });
});

describe("a group with exactly one line", () => {
  const ds = dataset({
    deliveryRows: [{ key: "r1", liId: "100" }],
    deliveryCells: { r1: { d1: "CTV" } },
    cm360Cells: { p1: { d1: "CTV" } },
    deliveryDaily: [day("r1", "2026-09-01", 1000)],
    cm360Daily: [day("p1", "2026-09-01", 1200), day("p1", "2026-09-09", 300)],
  });

  it("hands that line every CM360 row of the group", () => {
    const join = buildLineJoin(ds);
    const { pair, reason } = join.lineAt("impressions", "100", null);
    expect(reason).toBeNull();
    expect(pair).toEqual({ delivery: 1000, cm360: 1500, delta: 0.5 });
  });

  it("includes a late day the line did not deliver on - there is nobody else it could be", () => {
    const join = buildLineJoin(ds);
    // Sep 9 carries CM360 and no delivery; it still belongs to the one line of the group.
    expect(join.lineAt("impressions", "100", null).pair.cm360).toBe(1500);
  });

  it("reads one day on its own", () => {
    const join = buildLineJoin(ds);
    expect(join.dayAt("impressions", "2026-09-01", "100").pair)
      .toEqual({ delivery: 1000, cm360: 1200, delta: 0.2 });
  });
});

describe("a group two lines share", () => {
  /** Both lines classify as CTV in the same month; only line 100 delivered on Sep 1. */
  const ds = dataset({
    deliveryRows: [{ key: "r1", liId: "100" }, { key: "r2", liId: "200" }],
    deliveryCells: { r1: { d1: "CTV" }, r2: { d1: "CTV" } },
    cm360Cells: { p1: { d1: "CTV" } },
    deliveryDaily: [day("r1", "2026-09-01", 1000), day("r2", "2026-09-02", 500)],
    cm360Daily: [day("p1", "2026-09-01", 900)],
  });

  it("gives a day exactly one of them delivered on to that line", () => {
    const join = buildLineJoin(ds);
    expect(join.dayAt("impressions", "2026-09-01", "100").pair)
      .toEqual({ delivery: 1000, cm360: 900, delta: -0.1 });
  });

  it("withholds the number where both delivered, rather than splitting it", () => {
    // A guess here reads as fact on screen. The row says it is shared and names who with.
    const shared = dataset({
      deliveryRows: [{ key: "r1", liId: "100" }, { key: "r2", liId: "200" }],
      deliveryCells: { r1: { d1: "CTV" }, r2: { d1: "CTV" } },
      cm360Cells: { p1: { d1: "CTV" } },
      deliveryDaily: [day("r1", "2026-09-01", 1000), day("r2", "2026-09-01", 500)],
      cm360Daily: [day("p1", "2026-09-01", 900)],
    });
    const join = buildLineJoin(shared);
    const { pair, reason } = join.dayAt("impressions", "2026-09-01", "100");
    expect(pair).toEqual({ delivery: 1000, cm360: null, delta: null });
    expect(reason).toEqual({ kind: "shared", with: ["200"], day: true });
  });
});

describe("CM360 that belongs to nobody here", () => {
  it("leaves out a row no line of this pacing classifies - another pacing's placement", () => {
    // One CM360 campaign can carry several pacings' placements. Attributing those would inflate
    // every line in this one.
    const ds = dataset({
      deliveryRows: [{ key: "r1", liId: "100" }],
      deliveryCells: { r1: { d1: "CTV" } },
      cm360Cells: { p1: { d1: "CTV" }, p2: { d1: "Audio" } },
      deliveryDaily: [day("r1", "2026-09-01", 1000)],
      cm360Daily: [day("p1", "2026-09-01", 900), day("p2", "2026-09-01", 7777)],
    });
    const join = buildLineJoin(ds);
    expect(join.lineAt("impressions", "100", null).pair.cm360).toBe(900);
  });

  it("leaves out an unclassified CM360 row rather than guessing a line for it", () => {
    const ds = dataset({
      deliveryRows: [{ key: "r1", liId: "100" }],
      deliveryCells: { r1: { d1: "CTV" } },
      cm360Cells: { p1: { d1: "CTV" }, p2: { d1: null } },
      deliveryDaily: [day("r1", "2026-09-01", 1000)],
      cm360Daily: [day("p1", "2026-09-01", 900), day("p2", "2026-09-01", 4444)],
    });
    expect(buildLineJoin(ds).lineAt("impressions", "100", null).pair.cm360).toBe(900);
  });
});

describe("the window", () => {
  it("a range cuts what a line sums, on both sides", () => {
    const ds = dataset({
      deliveryRows: [{ key: "r1", liId: "100" }],
      deliveryCells: { r1: { d1: "CTV" } },
      cm360Cells: { p1: { d1: "CTV" } },
      deliveryDaily: [day("r1", "2026-09-01", 1000), day("r1", "2026-09-05", 400)],
      cm360Daily: [day("p1", "2026-09-01", 900), day("p1", "2026-09-05", 100)],
    });
    const join = buildLineJoin(ds);
    const within = join.lineAt("impressions", "100", { from: "2026-09-01", to: "2026-09-01" });
    expect(within.pair).toEqual({ delivery: 1000, cm360: 900, delta: -0.1 });
  });
});

describe("the reader itself", () => {
  it("answers null for a dataset it cannot read, rather than throwing", () => {
    expect(buildLineJoin(null)).toBeNull();
  });

  it("is built once per dataset", () => {
    // Every row of a table asks for it; rebuilding per row would walk both daily series again.
    const ds = dataset({
      deliveryRows: [], deliveryCells: {}, cm360Cells: {}, deliveryDaily: [], cm360Daily: [],
    });
    expect(buildLineJoin(ds)).toBe(buildLineJoin(ds));
  });
});
