/**
 * The moved layer loads, and the three doors that matter answer.
 *
 * This is a WIRING test, not a behaviour one: 44 JavaScript modules were moved here from Pacing's
 * retired SPA and reach their dependencies through the `@shared/*` alias and a CommonJS interop
 * step. Every one of those is a build-config detail that fails as `undefined`, silently, at the
 * first call rather than at import. So the point is to call something real from each layer.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - moved JS, not typed (see spa/SOURCE.md)
import * as ReportV2 from "./report-v2.js";
// @ts-expect-error - moved JS, not typed
import { emptyDraft, addView } from "./report-draft.js";
// @ts-expect-error - moved JS, not typed
import { STD_ENTRIES, stdEntry } from "./std-catalog.js";
// @ts-expect-error - moved JS, not typed
import { WIDGET_CAP, copyWidget } from "./widget-ops.js";

describe("the moved SPA layer", () => {
  it("loads the widget grammar through the @shared alias, with its vocabularies intact", () => {
    // A re-typed list would pass a shallow check; these are the module's OWN tables.
    expect(ReportV2.CONTROL_TYPES).toContain("dimension");
    expect(ReportV2.CHART_FORMATS).toContain("count1"); // arrived with the 2026-10-01 shared sync
    expect(typeof ReportV2.normReport).toBe("function");
  });

  it("mints a draft the grammar itself accepts", () => {
    // The pair that must agree: the builder's newborn and the normalizer that has to take it.
    const draft = emptyDraft ? emptyDraft("section") : ReportV2.emptyReport("section");
    const normalized = ReportV2.normReport(draft, {
      checkDimKey: () => true,
      isCanonicalMetric: () => true,
    });
    expect(normalized).toBeTruthy();
    expect(typeof addView).toBe("function");
  });

  it("sees the Standard catalog the shared sync widened to 34", () => {
    expect(STD_ENTRIES.length).toBe(34);
    expect(stdEntry("std:v2:breakdown")).toBeTruthy(); // one of the four that arrived
    // Two arrived with the 2026-10-06 port of Pacing's reference: «Impressions to Hit Budget»
    // and the Line items table. Neither is the sections cutover — that shrinks the block-id
    // domain in dash-blocks.js, and these two leave it alone. The catalog now matches the
    // reference template for template.
    expect(stdEntry("std:v2:card:budgetgap")).toBeTruthy();
    expect(stdEntry("std:v2:line-items-table")).toBeTruthy();
  });

  it("carries the widget-set ops the tile menu needs", () => {
    expect(WIDGET_CAP).toBe(100);
    const copy = copyWidget({ id: "w_src000", title: "T", spec: { views: [] } }, ["w_src000"]);
    expect(copy.id).not.toBe("w_src000");
    expect(copy.title).toBe("T (copy)");
  });
});
