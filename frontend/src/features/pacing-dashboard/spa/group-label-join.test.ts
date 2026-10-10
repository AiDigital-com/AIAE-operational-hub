import { describe, expect, it } from "vitest";
// @ts-expect-error - moved SPA module, plain JS with no types of its own
import { buildGroupLabelJoin } from "./group-label-join.js";

/**
 * CM360 beside a dimension that carries VALUE GROUPS (spec 2026-10-02).
 *
 * A value group renames rows PER LINE: a line that reads TX and FL as "South" puts its TX delivery
 * in the row South, while another line's TX stays in the row TX. The pivot built from the rows as
 * delivered would hand all TX CM360 to the row TX and none to South - which is why the pivot is
 * built again with every row read through its own line's dictionary.
 *
 * The rule that matters most here is the one about disagreement: where two lines read the same
 * value differently and both delivered, the CM360 cannot honestly go to either name, so the row
 * withholds it rather than picking one.
 */

type Cells = Record<string, Record<string, string | null>>;

function dataset(opts: {
  deliveryRows: { key: string; liId: string }[];
  deliveryCells: Cells;
  cm360Cells: Cells;
  deliveryDaily: Record<string, unknown>[];
  cm360Daily: Record<string, unknown>[];
}) {
  return {
    dims: [{ id: "d1", name: "Geo" }],
    classified: {
      perDim: [{ dimId: "d1", dCount: 1, dTotal: 1, cCount: 1, cTotal: 1 }],
      deliveryCells: opts.deliveryCells,
      cm360Cells: opts.cm360Cells,
    },
    activeDeliveryRows: opts.deliveryRows,
    deliveryDaily: opts.deliveryDaily,
    cm360Daily: opts.cm360Daily,
  };
}

const day = (key: string, date: string, impressions: number) => ({ key, date, impressions });
const GEO = { id: "d1", name: "Geo" };

/** Line 100 reads TX as "South"; nobody else renames anything. */
const southOnly = (li: string, value: string) =>
  (li === "100" && value === "TX" ? "South" : null);

describe("when the join does not apply", () => {
  const plain = dataset({
    deliveryRows: [{ key: "r1", liId: "100" }],
    deliveryCells: { r1: { d1: "TX" } },
    cm360Cells: { p1: { d1: "TX" } },
    deliveryDaily: [day("r1", "2026-09-01", 1000)],
    cm360Daily: [day("p1", "2026-09-01", 900)],
  });

  it("answers null when nothing is renamed, so the plain pivot is read", () => {
    const join = buildGroupLabelJoin(plain, { dims: [GEO], nameOf: () => null });
    expect(join).toBeNull();
  });

  it("answers null for a breakdown of two dimensions - no row has one value to rename", () => {
    const join = buildGroupLabelJoin(plain, {
      dims: [GEO, { id: "d2" }], nameOf: southOnly,
    });
    expect(join).toBeNull();
  });

  it("answers null for Month, which every row has and nobody groups", () => {
    const join = buildGroupLabelJoin(plain, {
      dims: [{ id: "m", auto_kind: "month" }], nameOf: southOnly,
    });
    expect(join).toBeNull();
  });

  it("answers null without a nameOf to ask", () => {
    expect(buildGroupLabelJoin(plain, { dims: [GEO] })).toBeNull();
  });
});

describe("a value one line groups", () => {
  // Line 100 delivers TX and calls it South. Its CM360 placement classifies as TX.
  const ds = dataset({
    deliveryRows: [{ key: "r1", liId: "100" }],
    deliveryCells: { r1: { d1: "TX" } },
    cm360Cells: { p1: { d1: "TX" } },
    deliveryDaily: [day("r1", "2026-09-01", 1000)],
    cm360Daily: [day("p1", "2026-09-01", 900)],
  });

  it("puts the line's CM360 under the GROUP's name, not the delivered value", () => {
    const join = buildGroupLabelJoin(ds, { dims: [GEO], nameOf: southOnly });
    expect(join).not.toBeNull();
    expect(join.pairAt("impressions", "South"))
      .toEqual({ delivery: 1000, cm360: 900, delta: -0.1 });
  });

  it("leaves nothing under the delivered value - that row is not where the delivery is", () => {
    const join = buildGroupLabelJoin(ds, { dims: [GEO], nameOf: southOnly });
    // No such row exists once the line's dictionary is applied - all of its TX is under South.
    expect(join.pairAt("impressions", "TX")).toBeNull();
  });
});

describe("two lines that read one value differently", () => {
  // Both deliver TX on the same day; line 100 calls it South, line 200 leaves it TX.
  const ds = dataset({
    deliveryRows: [{ key: "r1", liId: "100" }, { key: "r2", liId: "200" }],
    deliveryCells: { r1: { d1: "TX" }, r2: { d1: "TX" } },
    cm360Cells: { p1: { d1: "TX" } },
    deliveryDaily: [day("r1", "2026-09-01", 1000), day("r2", "2026-09-01", 500)],
    cm360Daily: [day("p1", "2026-09-01", 900)],
  });
  const join = () => buildGroupLabelJoin(ds, { dims: [GEO], nameOf: southOnly });

  it("still shows each row's own delivery", () => {
    expect(join().pairAt("impressions", "South").delivery).toBe(1000);
    expect(join().pairAt("impressions", "TX").delivery).toBe(500);
  });

  it("withholds the CM360 rather than giving it to one of the two names", () => {
    // Either choice would be a guess printed as a figure.
    expect(join().pairAt("impressions", "South").cm360).toBeNull();
    expect(join().pairAt("impressions", "TX").cm360).toBeNull();
  });

  it("says WHY the row is blank", () => {
    // Names the value, the lines that disagreed, and the two rows it could have gone to - which
    // is what the tile needs to explain the dash instead of just printing one.
    expect(join().reasonAt("South")).toEqual({
      kind: "groupShared", values: ["TX"], lines: ["100", "200"], labels: ["South", "TX"],
    });
  });

  it("sets the withheld CM360 aside rather than dropping it", () => {
    // It has to be somewhere: a comparison whose total silently shrinks is worse than a dash.
    // The whole 900 is parked as shared, and none of it is reported as left out.
    expect(join().remainder(["South", "TX"]).impressions).toEqual({
      other: { cm360: 900, shared: 900, noDay: 0, offRow: 0, dashed: 0 },
      leftOut: { cm360: 0, total: 900 },
    });
  });
});
