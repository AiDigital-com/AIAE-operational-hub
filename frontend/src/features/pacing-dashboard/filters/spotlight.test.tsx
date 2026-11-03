/**
 * The "Filter anything…" pop-up driven for real - ported from the reference's
 * `tests/dashboard/filter-spotlight.test.js` (filter spotlight spec 2026-10-01): it stays open after
 * a toggle, the Active rows remove, Clear all, the one-line Active during a search, the frozen Active
 * section while the pointer is inside, the identity-tracked highlight, Show more / Show all, the
 * Backspace rule, the two-step Escape and the reopen, keyboard traversal and the frozen range row's
 * restore. Adapted to the Hub's shapes (`channel` for `ch`, a flat `factsDaily`).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Spotlight, buildRows } from "./spotlight";
import {
  buildFilterSources,
  countsFor,
  TIER_SENTENCES,
  TOUCH_FOOTER,
  type ActiveItem,
  type FilterSource,
  type SpotlightLiPlan,
} from "./spotlight-core";
import { DEFAULT_FILTERS, type DashboardFilters } from "./types";
import type { FactRow } from "../journal/fact-dims";

const LI_PLAN: Record<string, SpotlightLiPlan> = {
  "100": {
    channel: "Video",
    labels: ["priority"],
    description: "Hero video",
    containers: [
      { target_impressions: 1000, dim_children: [{ dim_key: "geo", dim_value: "TX", target_mode: "absolute", target_value: 400 }] },
    ],
  },
  "200": { channel: "Display", labels: ["priority", "Q3"] },
  "300": { channel: "Display", labels: [] },
};
const FACTS: FactRow[] = [
  { line_item_id: 100, platform: "TTD", geo: "TX", audience: "Lookalike" },
  { line_item_id: 200, platform: "dv_360_dlv", geo: "NY", audience: "Lookalike" },
  { line_item_id: 300, platform: "dv_360_dlv", geo: "TX", audience: "" },
];
const SOURCES = buildFilterSources({ liPlan: LI_PLAN, factsDaily: FACTS });
const COUNTS = countsFor(SOURCES, { liPlan: LI_PLAN, factsDaily: FACTS });
const SCOPE_TX = { brkf: ["geo:TX"] };

const idOf = (key: string) => `spot-opt-${key.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;
const rowKeyed = (key: string) => document.getElementById(idOf(key));
const popup = () => screen.queryByRole("listbox");
const input = () => screen.getByRole("combobox") as HTMLInputElement;
const activeRows = () => [...document.querySelectorAll<HTMLElement>(".spot__row")].filter((n) => n.id.startsWith("spot-opt-active"));
const labelOf = (el: Element | null) => el?.querySelector(".spot__label-text")?.textContent ?? "";
const countOf = (el: Element | null) => el?.querySelector(".spot__count")?.textContent ?? "";
const highlighted = () => document.querySelector("[class*='--active']");
const press = (el: Element | null) => fireEvent.mouseDown(el!, { button: 0 });

function mount(filters: DashboardFilters = DEFAULT_FILTERS, over: { sources?: FilterSource[]; counts?: Map<string, number>; liPlan?: Record<string, SpotlightLiPlan> } = {}) {
  const onApply = vi.fn();
  const onRemove = vi.fn();
  const onClear = vi.fn();
  const onExplain = vi.fn();
  const props = {
    sources: over.sources ?? SOURCES,
    counts: over.counts ?? COUNTS,
    liPlan: over.liPlan ?? LI_PLAN,
    scopeFilters: SCOPE_TX,
    onApply,
    onRemove,
    onClear,
    onExplain,
  };
  const view = render(<Spotlight {...props} filters={filters} />);
  const setFilters = (next: DashboardFilters) => view.rerender(<Spotlight {...props} filters={next} />);
  const focus = () => fireEvent.focus(input());
  const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
  const key = (k: string, extra: Record<string, unknown> = {}) => fireEvent.keyDown(input(), { key: k, ...extra });
  return { onApply, onRemove, onClear, onExplain, setFilters, focus, type, key };
}

describe("Spotlight", () => {
  it("focus opens browse: SCOPE then LENS, kinds grouped, counts and glyphs, nothing active", () => {
    const { focus } = mount();
    expect(popup()).toBeNull();
    focus();

    expect([...document.querySelectorAll(".spot__caption")].map((n) => n.textContent)).toEqual([
      "SCOPE · paces the dashboard",
      "LENS · breakdown only",
    ]);
    expect(activeRows()).toHaveLength(0);
    expect(countOf(rowKeyed("scope:channel:Video"))).toBe("1 line");
    expect(rowKeyed("scope:channel:Video")).toHaveAttribute("aria-selected", "false");
    expect(countOf(rowKeyed("scope:label:priority"))).toBe("2 lines");
    expect(countOf(rowKeyed("scope:geo:TX"))).toBe("1 line"); // a split value counts the lines carrying the split
    expect(countOf(rowKeyed("lens:geo:NY"))).toBe("1 line");
    expect(countOf(rowKeyed("scope:li:100"))).toBe("Video"); // a line item row shows its channel
    expect(rowKeyed("scope:geo:TX")).toHaveTextContent("· split");
    expect(document.querySelector(".spot__footer")).toHaveTextContent(TOUCH_FOOTER);
  });

  it("a click toggles ON through onApply and the pop-up stays open; an on row toggles OFF through onRemove", () => {
    const { onApply, onRemove, focus, setFilters } = mount();
    focus();
    press(rowKeyed("scope:channel:Video"));
    expect(onApply).toHaveBeenCalledWith({ channels: ["Video"], selection: [] });
    expect(popup()).not.toBeNull();

    setFilters({ ...DEFAULT_FILTERS, channels: ["Video"] });
    const on = rowKeyed("scope:channel:Video");
    expect(on).toHaveAttribute("aria-selected", "true");
    expect(on).toHaveClass("spot__row--on");
    expect(activeRows()).toHaveLength(1);
    press(on);
    expect(onRemove).toHaveBeenCalledWith("channel", "Video");
    expect(popup()).not.toBeNull();
  });

  it("Active rows: chips order, labels, source-less row, removal, Clear all", () => {
    const filters = { ...DEFAULT_FILTERS, selection: ["100", "999"], channels: ["Display"], platforms: ["TTD"], brkf: ["geo:TX"], range: "7" };
    const { onRemove, onClear, focus } = mount(filters);
    focus();
    const active = activeRows();

    expect(active.map(labelOf)).toEqual(["Hero video", "LI 999", "Display", "geo: TX", "7d", "The Trade Desk"]);
    expect(active.every((n) => n.getAttribute("aria-selected") === "true")).toBe(true);
    expect(active[0].querySelector(".spot__sub")).toHaveTextContent("LI 100");
    expect(active[1]).toHaveClass("spot__row--missing");
    expect(active.map((n) => n.querySelector(".spot__tag")?.textContent)).toEqual(["SCOPE", "SCOPE", "SCOPE", "SCOPE", "SCOPE", "LENS"]);
    press(active[3]);
    expect(onRemove).toHaveBeenLastCalledWith("breakdown", "geo:TX");
    press(active[4]);
    expect(onRemove).toHaveBeenLastCalledWith("range", "7");
    press(document.querySelector(".spot__clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(popup()).not.toBeNull();
  });

  it("during a search the Active section is one line, rows carry tier tags, Show all lifts the cap", () => {
    const many: Record<string, SpotlightLiPlan> = {};
    for (let i = 0; i < 25; i += 1) many[`c${i}`] = { channel: `Chan ${i}`, labels: [] };
    const sources = buildFilterSources({ liPlan: many, factsDaily: [] });
    const { onClear, focus, type } = mount({ ...DEFAULT_FILTERS, channels: ["Chan 1"] }, { sources, counts: countsFor(sources, { liPlan: many }), liPlan: many });
    focus();
    type("chan");

    expect(document.querySelector(".spot__line")).toHaveTextContent("1 active · Clear all");
    expect(activeRows()).toHaveLength(0);
    expect(document.querySelectorAll(".spot__row")).toHaveLength(20);
    expect(document.querySelector(".spot__more")).toHaveTextContent("Show all 25 matches");
    expect([...document.querySelectorAll(".spot__row")].every((n) => n.querySelectorAll(".spot__tag").length === 2)).toBe(true);
    press(document.querySelector(".spot__more"));
    expect(document.querySelectorAll(".spot__row")).toHaveLength(25);
    press(document.querySelector(".spot__line"));
    expect(onClear).toHaveBeenCalledTimes(1);
    type("zzz");
    expect(document.querySelector(".spot__empty")).toHaveTextContent("No matches for “zzz”");
  });

  it("Show {n} more expands one kind in one tier only", () => {
    const many: Record<string, SpotlightLiPlan> = {};
    for (let i = 0; i < 9; i += 1) many[`c${i}`] = { channel: `Ch${i}`, labels: [] };
    const sources = buildFilterSources({ liPlan: many, factsDaily: [] });
    const { focus } = mount(DEFAULT_FILTERS, { sources, counts: countsFor(sources, { liPlan: many }), liPlan: many });
    focus();
    const more = [...document.querySelectorAll(".spot__more")];

    expect(more.map((n) => n.textContent)).toEqual(["Show 3 more", "Show 3 more"]); // line items and channels
    press(more[1]);
    expect([...document.querySelectorAll(".spot__more")].map((n) => n.textContent)).toEqual(["Show 3 more"]);
    expect([...document.querySelectorAll(".spot__row")].filter((n) => n.id.startsWith(idOf("scope:channel")))).toHaveLength(9);
  });

  it("keyboard: nothing highlighted on open, ArrowDown lands on the first option row, Enter toggles, Home jumps, the panel follows", () => {
    const { onApply, onRemove, onClear, onExplain, focus, key } = mount({ ...DEFAULT_FILTERS, channels: ["Video"] });
    focus();
    expect(highlighted()).toBeNull();
    key("Enter");
    expect([onApply.mock.calls.length, onRemove.mock.calls.length, onClear.mock.calls.length]).toEqual([0, 0, 0]);

    key("ArrowDown");
    expect(labelOf(highlighted())).toBe("Video"); // the first option row, never Clear all
    key("ArrowUp");
    expect(highlighted()).toHaveClass("spot__clear");
    key("ArrowDown");
    expect(labelOf(highlighted())).toBe("Video");
    expect(onExplain).toHaveBeenLastCalledWith(expect.objectContaining({ title: "1 line", sentence: TIER_SENTENCES.scope }));
    key("Enter");
    expect(onRemove).toHaveBeenCalledWith("channel", "Video");
    key("End");
    expect(highlighted()).not.toBeNull();
    key("Home");
    expect(highlighted()).toHaveClass("spot__clear");
    expect(input()).toHaveAttribute("aria-activedescendant", idOf("sec:active"));
  });

  it("Escape clears the query first, then closes; typing or ArrowDown reopens; Tab out closes", () => {
    const { focus, type, key } = mount();
    focus();
    type("vid");
    key("Escape");
    expect(input().value).toBe("");
    expect(popup()).not.toBeNull();
    key("Escape");
    expect(popup()).toBeNull();
    key("ArrowDown");
    expect(popup()).not.toBeNull();
    key("Escape");
    type("v");
    expect(popup()).not.toBeNull();
    fireEvent.blur(input(), { relatedTarget: null });
    expect(popup()).toBeNull();
  });

  it("Backspace on an already-empty input removes the last chip; not on auto-repeat, not with a query", () => {
    const { onRemove, focus, key, type } = mount({ ...DEFAULT_FILTERS, channels: ["Video"], platforms: ["TTD"], range: "7" });
    focus();
    key("Backspace", { repeat: true });
    expect(onRemove).not.toHaveBeenCalled();
    key("Backspace");
    expect(onRemove).toHaveBeenCalledWith("platform", "TTD"); // the last chip is the last Lens chip
    type("x");
    key("Backspace");
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("the Active section freezes while the pointer is inside the list and thaws when it leaves", () => {
    const { focus, setFilters } = mount({ ...DEFAULT_FILTERS, channels: ["Video"] });
    focus();
    fireEvent.pointerEnter(popup()!);
    setFilters({ ...DEFAULT_FILTERS, channels: ["Video", "Display"] });
    expect(activeRows()).toHaveLength(1); // not inserted yet
    expect(rowKeyed("scope:channel:Display")).toHaveAttribute("aria-selected", "true");
    setFilters({ ...DEFAULT_FILTERS, channels: ["Display"] });
    expect(activeRows()).toHaveLength(1);
    expect(activeRows()[0]).toHaveAttribute("aria-selected", "false"); // a removed filter keeps its place
    fireEvent.pointerLeave(popup()!);
    expect(activeRows().map(labelOf)).toEqual(["Display"]);
  });

  it("a frozen removed range row puts the range back; a right-click does nothing", () => {
    const { onApply, focus, setFilters } = mount({ ...DEFAULT_FILTERS, channels: ["Video"], range: "7" });
    focus();
    fireEvent.pointerEnter(popup()!);
    setFilters({ ...DEFAULT_FILTERS, channels: ["Video"] });
    const frozenRange = rowKeyed("active:range:7");
    expect(frozenRange).toHaveAttribute("aria-selected", "false");
    fireEvent.mouseDown(frozenRange!, { button: 2 });
    expect(onApply).not.toHaveBeenCalled();
    press(frozenRange);
    expect(onApply).toHaveBeenCalledWith({ range: "7", customRange: { from: "", to: "" } });
  });

  it("Enter after typing picks the top match and keeps the query", () => {
    const { onApply, onClear, focus, type, key } = mount({ ...DEFAULT_FILTERS, channels: ["Video"] });
    focus();
    type("priority");
    key("Enter");
    expect(onClear).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledWith({ labels: ["priority"] });
    expect(input().value).toBe("priority");
  });

  it("buildRows: the on row of a value with a split shows the actual tier the chips give it", () => {
    const liveActive: ActiveItem[] = [
      { key: "geo:TX", type: "geo", value: "TX", label: "geo: TX", tier: "lens", missing: false, display: "geo: TX", name: "" },
    ];
    const rows = buildRows({
      q: "",
      liveActive,
      activeRows: liveActive,
      filters: { ...DEFAULT_FILTERS, brkf: ["geo:TX"] },
      browse: { scope: [{ kind: "geo", items: [SOURCES.find((s) => s.type === "geo" && s.value === "TX")!], hidden: 0 }], lens: [] },
      hitGroups: [],
      hits: [],
      showAll: false,
      actualTier: new Map([["geo:TX", "lens"]]),
    });
    const browseRow = rows.find((r) => r.key === "scope:geo:TX");
    expect(browseRow).toMatchObject({ on: true, tier: "lens" });
  });
});
