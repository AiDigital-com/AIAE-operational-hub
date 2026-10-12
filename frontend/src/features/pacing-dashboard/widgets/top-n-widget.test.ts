import { describe, expect, it } from "vitest";
import { topNCompositeFor } from "./top-n-widget.js";

const SOURCE = {
  id: "apps",
  origin: {
    columns: {
      metrics: { im: "Impressions", cl: "Clicks", pc: "Post-Click Conv.", pv: "Post-View Conv." },
    },
  },
};
const DIM = { key: "app_url", label: "App/URL", column: "App/URL" };

/**
 * These assertions are the SERVER's rules, restated. `widgets-validate.mjs` refuses a widget that
 * is not `composite`/schemaVersion 2 with a known profile, and the refusal lands on Save - three
 * tabs away from the button that minted it, naming an id the person never chose. The moved
 * `topNWidgetFor` returns the pre-v2 shape and fails every one of these.
 */
describe("topNCompositeFor", () => {
  it("mints a canonical widget, not the pre-v2 table shape", () => {
    const w = topNCompositeFor(SOURCE, DIM, 20);
    expect(w.kind).toBe("composite");
    expect(w.schemaVersion).toBe(2);
    expect(w.profile).toBe("table");
    expect(w.datasetType).toBe("delivery");
    expect(w.spec).toBeTruthy();
  });

  it("names the column it was built for, as a string a tile can print", () => {
    expect(topNCompositeFor(SOURCE, DIM, 20).title).toBe("App/URL");
    expect(topNCompositeFor(SOURCE, { key: "placement" }, 20).title).toBe("placement");
  });

  it("cuts the table by this source's axis", () => {
    const view = topNCompositeFor(SOURCE, DIM, 20).spec.views[0];
    expect(view.kind).toBe("table");
    expect(view.rows).toEqual({ type: "dim", key: "ds:apps:app_url" });
    expect(view.limit).toBe(20);
    expect(view.totals).toBe(true);
  });

  it("sorts by the ranking column, which is what makes it a top N", () => {
    // The table slices its limit AFTER sorting, so a limit with no sort shows the first N rows BY
    // NAME. Impressions lead when the source carries them.
    const w = topNCompositeFor(SOURCE, DIM, 20);
    expect(w.spec.views[0].sort).toEqual({ columnId: "im", dir: "desc" });
    expect(w.spec.views[0].columns[0].id).toBe("im");
  });

  it("ranks by the source's own first metric when it has no impressions", () => {
    const clicksOnly = { id: "clicks", origin: { columns: { metrics: { cl: "Clicks" } } } };
    const w = topNCompositeFor(clicksOnly, DIM, 10);
    expect(w.spec.views[0].sort).toEqual({ columnId: "cl", dir: "desc" });
    expect(w.spec.views[0].limit).toBe(10);
  });

  it("gives every column a canonical value, and only the metrics this source maps", () => {
    const w = topNCompositeFor(SOURCE, DIM, 20);
    const columns = w.spec.views[0].columns;
    expect(columns.map((c: { id: string }) => c.id)).toEqual(["im", "cl", "pc", "pv"]);
    for (const c of columns) {
      expect(c.kind).toBe("value");
      expect(c.value).toMatchObject({ kind: "metric", source: "bq", metric: c.id });
      expect(typeof c.label).toBe("string");
      expect(c.label).not.toBe("");
    }
  });

  it("follows the dashboard's period rather than pinning one", () => {
    expect(topNCompositeFor(SOURCE, DIM, 20).spec.period).toBeNull();
  });
});
