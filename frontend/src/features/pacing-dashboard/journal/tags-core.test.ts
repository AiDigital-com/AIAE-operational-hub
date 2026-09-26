import { describe, expect, it } from "vitest";
import {
  TAG_TYPES,
  CHIP_TYPES,
  parseTags,
  collectAllTags,
  buildTagSources,
  findActiveToken,
  scoreMatch,
  tagFrequencies,
  rankSources,
  isKnownTag,
  clampPopoverPosition,
  buildTagResolver,
  maybeConvertTrigger,
} from "./tags-core";

/**
 * Golden tests ported from the retired SPA's `tests/journal-tags-core-test.mjs`, case for case -
 * same inputs, same expected outputs. `tags-core.ts` is a faithful TypeScript port of
 * `workspace/src/lib/dashboard/journal-tags-core.js`, so this file exists to prove the port kept the
 * original's behaviour rather than merely reading like it.
 */

describe("parseTags", () => {
  it("extracts raw tags", () => {
    expect(parseTags("hi #LI:123 and #ch:Online_Video x").map((t) => t.raw)).toEqual(["#LI:123", "#ch:Online_Video"]);
  });
  it("returns empty for no tags", () => {
    expect(parseTags("no tags here")).toEqual([]);
  });
  it("has the expected shape", () => {
    expect(parseTags("#LI:7")[0]).toEqual({ type: "LI", value: "7", raw: "#LI:7" });
  });
});

describe("collectAllTags", () => {
  it("dedupes across msg/message", () => {
    expect(collectAllTags([{ msg: "#LI:1 #LI:1" }, { message: "#ch:x" }]).map((t) => t.raw)).toEqual([
      "#LI:1",
      "#ch:x",
    ]);
  });
});

describe("buildTagSources", () => {
  const SRC = buildTagSources({
    liPlan: { "123": { ch: "Online Video" }, "456": { ch: "Display" } },
    display: { liNames: { "123": "Video Prospecting" } },
    availableSplits: { audience: { "123": ["Auto Intenders"] } },
  });

  it('builds LI display "id — name"', () => {
    expect(SRC.find((s) => s.type === "LI" && s.value === "123")?.display).toBe("123 — Video Prospecting");
  });
  it("slugs channel", () => {
    expect(SRC.some((s) => s.type === "ch" && s.value === "Online_Video")).toBe(true);
  });
  it("slugs audience", () => {
    expect(SRC.some((s) => s.type === "aud" && s.value === "Auto_Intenders")).toBe(true);
  });
});

describe("findActiveToken", () => {
  it("returns null when there is no #", () => {
    expect(findActiveToken("abc", 3)).toBeNull();
  });
  it("finds a bare #", () => {
    expect(findActiveToken("a #", 3)).toEqual({ start: 2, type: null, query: "", raw: "#" });
  });
  it("returns a query with no type when there's no colon", () => {
    expect(findActiveToken("a #LI", 5)).toEqual({ start: 2, type: null, query: "LI", raw: "#LI" });
  });
  it("parses #type:query", () => {
    expect(findActiveToken("a #LI:vid", 9)).toEqual({ start: 2, type: "LI", query: "vid", raw: "#LI:vid" });
  });
  it("keeps the query as a live-typed prefix up to the caret", () => {
    expect(findActiveToken("a #LI:vi", 8)).toEqual({ start: 2, type: "LI", query: "vi", raw: "#LI:vi" });
  });
  it("breaks the token at a space", () => {
    expect(findActiveToken("#LI:1 done", 9)).toBeNull();
  });
  it("keeps an invalid type as an untyped query", () => {
    expect(findActiveToken("#zz:1", 5)).toEqual({ start: 0, type: null, query: "zz:1", raw: "#zz:1" });
  });
});

describe("scoreMatch (fuzzy subsequence)", () => {
  it("matches an empty query", () => {
    expect(scoreMatch("", "anything")).not.toBeNull();
  });
  it("returns null when there's no subsequence", () => {
    expect(scoreMatch("xyz", "abc")).toBeNull();
  });
  it("scores a contiguous prefix above a scattered match", () => {
    expect(scoreMatch("vid", "Video")! > scoreMatch("vid", "Vivid Ad")!).toBe(true);
  });
});

describe("tagFrequencies", () => {
  const FREQ = tagFrequencies([{ msg: "#LI:1 #LI:1" }, { msg: "#LI:1 #ch:x" }]);
  it("counts repeats", () => {
    expect(FREQ.get("LI:1")).toBe(3);
  });
  it("counts a single occurrence", () => {
    expect(FREQ.get("ch:x")).toBe(1);
  });
});

describe("rankSources", () => {
  const SOURCES = [
    { type: "LI", value: "1", display: "1 — Alpha" },
    { type: "LI", value: "2", display: "2 — Beta" },
    { type: "ch", value: "x", display: "XChan" },
  ];

  it("orders empty-query results recent then frequent", () => {
    const ranked = rankSources(SOURCES, {
      query: "",
      recents: [{ type: "ch", value: "x" }],
      freq: new Map([["LI:2", 5]]),
    });
    expect([ranked[0].value, ranked[1].value]).toEqual(["x", "2"]);
  });
  it("fuzzy-filters on a query", () => {
    expect(rankSources(SOURCES, { query: "alpha" }).map((r) => r.value)).toEqual(["1"]);
  });
  it("filters by the type chip", () => {
    expect(rankSources(SOURCES, { type: "ch", query: "" }).every((r) => r.type === "ch")).toBe(true);
  });
  it("flags a recent source", () => {
    expect(rankSources(SOURCES, { query: "", recents: [{ type: "ch", value: "x" }] })[0].recent).toBe(true);
  });

  it("excludes tags already typed into the entry (2026-07-11 journal edit)", () => {
    const srcs = [
      { type: "LI", value: "100", display: "LI 100" },
      { type: "LI", value: "200", display: "LI 200" },
      { type: "aud", value: "RT", display: "RT" },
    ];
    const out = rankSources(srcs, { exclude: new Set(["LI:100", "aud:RT"]) });
    expect(out.map((s) => `${s.type}:${s.value}`)).toEqual(["LI:200"]);
    const all = rankSources(srcs, {});
    expect(all.length).toBe(3);
  });
});

describe("isKnownTag", () => {
  const SOURCES = [
    { type: "LI", value: "1", display: "1 — Alpha" },
    { type: "LI", value: "2", display: "2 — Beta" },
    { type: "ch", value: "x", display: "XChan" },
  ];
  it("is true for a known tag", () => {
    expect(isKnownTag("LI", "1", SOURCES)).toBe(true);
  });
  it("is false for an unknown tag", () => {
    expect(isKnownTag("LI", "999", SOURCES)).toBe(false);
  });
});

describe("clampPopoverPosition", () => {
  const VP = { w: 1000, h: 800 };
  const SZ = { w: 240, h: 200 };
  it("places below when there's room (top = caret.top + lineHeight + gap)", () => {
    expect(clampPopoverPosition({ caret: { left: 100, top: 50, lineHeight: 16 }, size: SZ, viewport: VP })).toEqual({
      left: 100,
      top: 72,
      placement: "below",
    });
  });
  it("flips above when there's no room below", () => {
    expect(
      clampPopoverPosition({ caret: { left: 100, top: 700, lineHeight: 16 }, size: SZ, viewport: VP }).placement
    ).toBe("above");
  });
  it("clamps left to viewport.w - size.w - gap", () => {
    expect(
      clampPopoverPosition({ caret: { left: 900, top: 50, lineHeight: 16 }, size: SZ, viewport: VP }).left
    ).toBe(754);
  });
});

describe("DSP / platform tag", () => {
  it("includes dsp in TAG_TYPES", () => {
    expect(TAG_TYPES).toContain("dsp");
  });
  it("parses a dsp tag", () => {
    expect(parseTags("paused #dsp:dv_360_dlv today")[0]).toEqual({
      type: "dsp",
      value: "dv_360_dlv",
      raw: "#dsp:dv_360_dlv",
    });
  });
  it("resolves the dsp type from an active token", () => {
    expect(findActiveToken("a #dsp:ttd", 10)?.type).toBe("dsp");
  });

  const SRC2 = buildTagSources({
    liPlan: {},
    platforms: [
      { value: "dv_360_dlv", display: "DV360" },
      { value: "Google Ads", display: "Google Ads" }, // not slug-safe → skipped
    ],
  });
  it("sets dsp value to the raw platform", () => {
    expect(SRC2.find((s) => s.type === "dsp")?.value).toBe("dv_360_dlv");
  });
  it("sets dsp display to the pretty label", () => {
    expect(SRC2.find((s) => s.type === "dsp")?.display).toBe("DV360");
  });
  it("skips a non-slug-safe platform", () => {
    expect(SRC2.filter((s) => s.type === "dsp").length).toBe(1);
  });
  it("is known once built", () => {
    expect(isKnownTag("dsp", "dv_360_dlv", SRC2)).toBe(true);
  });
});

describe("tactic (breakdown-dim tag)", () => {
  it("includes tactic in TAG_TYPES", () => {
    expect(TAG_TYPES).toContain("tactic");
  });

  const SRC3 = buildTagSources({ liPlan: {}, breakdowns: [{ type: "tactic", values: ["Prospecting", "Lower Funnel"] }] });
  it("slugifies the value, keeps the raw display", () => {
    expect(SRC3.find((s) => s.type === "tactic" && s.display === "Lower Funnel")?.value).toBe("Lower_Funnel");
  });
  it("keeps both values", () => {
    expect(SRC3.filter((s) => s.type === "tactic").length).toBe(2);
  });
});

describe("buildTagResolver (slug → raw label for cross-link)", () => {
  const SRC4 = buildTagSources({
    liPlan: { "1": { ch: "Online Video" } },
    breakdowns: [{ type: "tactic", values: ["Lower Funnel"] }],
  });
  const RES = buildTagResolver(SRC4, ["ch", "tactic"]);
  it("resolves a channel slug back to its raw name", () => {
    expect(RES.get("ch:Online_Video")).toBe("Online Video");
  });
  it("resolves a tactic slug back to its raw value", () => {
    expect(RES.get("tactic:Lower_Funnel")).toBe("Lower Funnel");
  });
  it("skips non-resolved types", () => {
    expect(RES.has("LI:1")).toBe(false);
  });
});

describe("maybeConvertTrigger (\\ → # on Russian layout)", () => {
  it("converts \\ at a word boundary", () => {
    expect(maybeConvertTrigger("a \\", 3)).toEqual({ value: "a #", converted: true });
  });
  it("converts \\ at the start", () => {
    expect(maybeConvertTrigger("\\", 1)).toEqual({ value: "#", converted: true });
  });
  it("does not convert \\ mid-token", () => {
    expect(maybeConvertTrigger("C:\\x", 3)).toEqual({ value: "C:\\x", converted: false });
  });
  it("leaves text with no backslash unchanged", () => {
    expect(maybeConvertTrigger("hi", 2)).toEqual({ value: "hi", converted: false });
  });
});

describe("all breakdown dims are tag types", () => {
  for (const d of ["geo", "creative", "comment", "message", "keyword", "flight", "language"]) {
    it(`includes ${d}`, () => {
      expect(TAG_TYPES).toContain(d);
    });
  }
  it("parses a geo tag", () => {
    expect(parseTags("moved #geo:US today")[0]).toEqual({ type: "geo", value: "US", raw: "#geo:US" });
  });
  it("resolves a geo slug back to raw", () => {
    const SRC5 = buildTagSources({ liPlan: {}, breakdowns: [{ type: "geo", values: ["United States"] }] });
    expect(buildTagResolver(SRC5, ["geo"]).get("geo:United_States")).toBe("United States");
  });
});

describe("CHIP_TYPES is a curated subset (chips vs typed-only long tail)", () => {
  it("is an array", () => {
    expect(Array.isArray(CHIP_TYPES)).toBe(true);
  });
  it("is a subset of TAG_TYPES", () => {
    expect(CHIP_TYPES.every((t) => (TAG_TYPES as readonly string[]).includes(t))).toBe(true);
  });
  it("chips tactic but leaves geo typed-only", () => {
    expect(CHIP_TYPES.includes("tactic") && !CHIP_TYPES.includes("geo")).toBe(true);
  });
});

describe("label tag type (plan.labels arrays → #label: cross-link)", () => {
  it("parses alongside long-tail dims", () => {
    const tags = parseTags("renewal push #label:Q3_upsell and #language:en");
    expect(tags.map((t) => t.type)).toEqual(["label", "language"]);
  });

  it("builds slug value / raw display sources, deduped across LIs", () => {
    const sources = buildTagSources({
      liPlan: {
        1: { ch: "Video", labels: ["Q3 upsell", "priority"] },
        2: { ch: "Display", labels: ["priority"] },
      },
    });
    const labels = sources.filter((s) => s.type === "label");
    expect(labels.map((s) => [s.value, s.display]).sort()).toEqual(
      [
        ["Q3_upsell", "Q3 upsell"],
        ["priority", "priority"],
      ].sort()
    );
    const resolver = buildTagResolver(sources, ["label"]);
    expect(resolver.get("label:Q3_upsell")).toBe("Q3 upsell");
  });
});
