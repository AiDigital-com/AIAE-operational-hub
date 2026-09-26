/**
 * Ported from the retired SPA's `tests/filter-spotlight-core-test.mjs` - same assertions, adapted
 * to the Hub's own input shapes (see `spotlight-core.ts`'s docblock for what changed and why).
 * `classifyActive` is NOT ported (never ported to `spotlight-core.ts` either) - `filter-bar.tsx`'s
 * own docblock already documents the chip-tiering it would drive as deliberately deferred.
 */
import { describe, expect, it } from "vitest";
import {
  buildFilterSources,
  browseSources,
  searchFilterSources,
  patchForSource,
  tierOf,
  KIND_LABELS,
  type SpotlightLiPlan,
} from "./spotlight-core";
import type { DashboardFilters } from "./types";
import type { FactRow } from "../journal/fact-dims";

const liPlan: Record<string, SpotlightLiPlan> = {
  "100": { channel: "Video", labels: ["priority"], description: "Hero video" },
  "200": { channel: "Display", labels: ["priority", "Q3 upsell"] },
};
const factsDaily: FactRow[] = [
  { platform: "TTD", tactic: "Prospecting", audience: "Auto intenders", geo: "NY", creative: "banner_a", comment: "", message: "", keyword: "", flight: "", language: "en" },
  { platform: "dv_360_dlv", tactic: "Retargeting", audience: "", geo: "Austin, TX", creative: "", comment: "", message: "", keyword: "", flight: "", language: "" },
];

describe("buildFilterSources", () => {
  const sources = buildFilterSources({ liPlan, factsDaily });

  it("li source uses description as the display name", () => {
    expect(sources.some((s) => s.type === "li" && s.value === "100" && s.display === "100 — Hero video")).toBe(true);
  });
  it("channel/label sources are raw (no slugify)", () => {
    expect(sources.some((s) => s.type === "channel" && s.value === "Video")).toBe(true);
    expect(sources.some((s) => s.type === "label" && s.value === "Q3 upsell")).toBe(true);
  });
  it("platform source keeps the raw value, prettifies the display", () => {
    expect(sources.some((s) => s.type === "platform" && s.value === "dv_360_dlv" && s.display === "DV360")).toBe(true);
    expect(sources.some((s) => s.type === "platform" && s.value === "TTD" && s.display === "The Trade Desk")).toBe(true);
  });
  it("dim value with a comma survives", () => {
    expect(sources.some((s) => s.type === "geo" && s.value === "Austin, TX")).toBe(true);
  });
  it("every kind has a display label", () => {
    expect(Object.keys(KIND_LABELS).length).toBeGreaterThanOrEqual(12);
  });
});

describe("searchFilterSources", () => {
  const sources = buildFilterSources({ liPlan, factsDaily });

  it("fuzzy-matches the custom LI name", () => {
    expect(searchFilterSources(sources, "hero")[0]?.value).toBe("100");
  });
  it("matches the pretty platform label too", () => {
    expect(searchFilterSources(sources, "dv36").some((h) => h.value === "dv_360_dlv")).toBe(true);
  });
  it("empty query -> no results (the spotlight opens only on typing)", () => {
    expect(searchFilterSources(sources, "")).toEqual([]);
  });
});

describe("patchForSource", () => {
  const base: DashboardFilters = {
    range: "all",
    customRange: { from: "", to: "" },
    channels: [],
    labels: [],
    platforms: [],
    selection: [],
    brk: "",
    brkf: [],
    cols: null,
  };

  it("li -> selection", () => {
    expect(patchForSource(base, { type: "li", value: "100" })).toEqual({ selection: ["100"] });
  });
  it("channel -> channels, and clears selection (FilterBar coupling rule)", () => {
    expect(patchForSource(base, { type: "channel", value: "Video" })).toEqual({ channels: ["Video"], selection: [] });
  });
  it("label -> labels", () => {
    expect(patchForSource(base, { type: "label", value: "priority" })).toEqual({ labels: ["priority"] });
  });
  it("platform -> platforms", () => {
    expect(patchForSource(base, { type: "platform", value: "TTD" })).toEqual({ platforms: ["TTD"] });
  });
  it("a dim -> brk + brkf", () => {
    expect(patchForSource(base, { type: "geo", value: "NY" })).toEqual({ brk: "geo", brkf: ["geo:NY"] });
  });
  it("adding an already-active dim value is idempotent", () => {
    expect(patchForSource({ ...base, brkf: ["geo:NY"] }, { type: "geo", value: "NY" })).toEqual({ brk: "geo", brkf: ["geo:NY"] });
  });
});

describe("tierOf", () => {
  // 2026-09-25 follow-up (item 4): a dim value is LENS unconditionally in this build - this Hub
  // never vendored `dim-scope.js`, the engine that would actually re-pace a headline against a
  // declared split's own target, so a SCOPE label on a dim value would be a lie about the maths.
  // `splitKeys` is still accepted (and still built by `buildFilterSources` below) so the day
  // `dim-scope.js` lands, flipping this back is a one-line diff - see `tierOf`'s own comment.
  const splitKeys = new Set(["geo:TX", "geo:CA", "audience:Auto intenders"]);

  it("li/channel/label are always scope", () => {
    expect(tierOf({ type: "li", value: "100" }, splitKeys)).toBe("scope");
    expect(tierOf({ type: "channel", value: "Video" }, splitKeys)).toBe("scope");
    expect(tierOf({ type: "label", value: "priority" }, splitKeys)).toBe("scope");
  });
  it("platform is always lens", () => {
    expect(tierOf({ type: "platform", value: "TTD" }, splitKeys)).toBe("lens");
  });
  it("a dim value is lens even with a declared split - this build has no engine to back a SCOPE claim up", () => {
    expect(tierOf({ type: "geo", value: "TX" }, splitKeys)).toBe("lens");
    expect(tierOf({ type: "geo", value: "NY" }, splitKeys)).toBe("lens");
    expect(tierOf({ type: "audience", value: "Auto intenders" }, splitKeys)).toBe("lens");
    expect(tierOf({ type: "audience", value: "Lookalike" }, splitKeys)).toBe("lens");
  });
  it("empty splitKeys -> every dim value is lens too (same answer either way now)", () => {
    expect(tierOf({ type: "geo", value: "TX" }, new Set())).toBe("lens");
  });
});

describe("buildFilterSources - tier tagging end to end", () => {
  const splitLiPlan: Record<string, SpotlightLiPlan> = {
    "100": {
      channel: "Video",
      labels: ["priority"],
      containers: [
        {
          target_impressions: 1000,
          dim_children: [{ dim_key: "geo", dim_value: "TX", target_mode: "absolute", target_value: 400 }],
        },
      ],
    },
    "200": { channel: "Display", labels: [] },
  };
  const splitFacts: FactRow[] = [
    { platform: "TTD", tactic: "Prospecting", audience: "Auto intenders", geo: "TX" },
    { platform: "TTD", tactic: "Retargeting", audience: "Lookalike", geo: "NY" },
  ];
  const taggedSources = buildFilterSources({ liPlan: splitLiPlan, factsDaily: splitFacts });
  const findSrc = (type: string, value: string) => taggedSources.find((s) => s.type === type && s.value === value);

  it("li/channel/label -> scope, platform -> lens", () => {
    expect(findSrc("li", "100")?.tier).toBe("scope");
    expect(findSrc("channel", "Video")?.tier).toBe("scope");
    expect(findSrc("label", "priority")?.tier).toBe("scope");
    expect(findSrc("platform", "TTD")?.tier).toBe("lens");
  });
  it("split-backed dim value is STILL lens (item 4) - display is unaffected", () => {
    expect(findSrc("geo", "TX")?.tier).toBe("lens");
    expect(findSrc("geo", "NY")?.tier).toBe("lens");
    expect(findSrc("geo", "TX")?.display).toBe("TX");
  });
  it("search results carry tier", () => {
    expect(searchFilterSources(taggedSources, "TX")[0]?.tier).toBe("lens");
  });

  describe("browseSources", () => {
    const browse = browseSources(taggedSources);

    it("returns {scope, lens} arrays, each tier-pure", () => {
      expect(browse.scope.every((s) => s.tier === "scope")).toBe(true);
      expect(browse.lens.every((s) => s.tier === "lens")).toBe(true);
    });
    it("split-backed geo:TX lands in LENS too (item 4) - not promoted to SCOPE without dim-scope.js", () => {
      expect(browse.scope.some((s) => s.type === "geo" && s.value === "TX")).toBe(false);
      expect(browse.lens.some((s) => s.type === "geo" && s.value === "TX")).toBe(true);
    });
    it("non-split geo:NY lands in LENS", () => {
      expect(browse.lens.some((s) => s.type === "geo" && s.value === "NY")).toBe(true);
    });
    it("whole-unit sources land in SCOPE, platform in LENS", () => {
      expect(browse.scope.some((s) => s.type === "li" && s.value === "100")).toBe(true);
      expect(browse.scope.some((s) => s.type === "channel" && s.value === "Video")).toBe(true);
      expect(browse.scope.some((s) => s.type === "label" && s.value === "priority")).toBe(true);
      expect(browse.lens.some((s) => s.type === "platform" && s.value === "TTD")).toBe(true);
    });
    it("each group is ordered by KIND_LABELS key order", () => {
      const kindOrder = Object.keys(KIND_LABELS);
      const idxOf = (t: string) => kindOrder.indexOf(t);
      for (let i = 1; i < browse.scope.length; i += 1) {
        expect(idxOf(browse.scope[i].type)).toBeGreaterThanOrEqual(idxOf(browse.scope[i - 1].type));
      }
      for (let i = 1; i < browse.lens.length; i += 1) {
        expect(idxOf(browse.lens[i].type)).toBeGreaterThanOrEqual(idxOf(browse.lens[i - 1].type));
      }
    });
    it("per-kind cap limits how many of one kind survive", () => {
      const manyCh: Record<string, SpotlightLiPlan> = {};
      for (let i = 0; i < 9; i += 1) manyCh[`c${i}`] = { channel: `Ch${i}`, labels: [] };
      const cappedSources = buildFilterSources({ liPlan: manyCh, factsDaily: [] });
      const capped = browseSources(cappedSources, 2);
      expect(capped.scope.filter((s) => s.type === "channel").length).toBe(2);
      expect(capped.scope.filter((s) => s.type === "li").length).toBe(2);
    });
    it("empty sources -> empty groups, no throw", () => {
      expect(browseSources([])).toEqual({ scope: [], lens: [] });
    });
  });
});
