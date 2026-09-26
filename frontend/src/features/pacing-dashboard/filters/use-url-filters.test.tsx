import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { readFilterList, useUrlFilters, writeFilterList } from "./use-url-filters";

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter initialEntries={["/dash"]}>{children}</MemoryRouter>;
}

describe("readFilterList / writeFilterList (the comma-vs-key[] quirk)", () => {
  it("reads a comma-joined value back into a list", () => {
    const params = new URLSearchParams("ch=Display,Video");
    expect(readFilterList(params, "ch")).toEqual(["Display", "Video"]);
  });

  it("writes a plain list as one comma-joined param when no value contains a comma", () => {
    const params = new URLSearchParams();
    writeFilterList(params, "ch", ["Display", "Video"]);
    expect(params.toString()).toBe("ch=Display%2CVideo");
  });

  it("writes repeated key[] params instead when a value itself contains a comma", () => {
    const params = new URLSearchParams();
    writeFilterList(params, "label", ["Austin, TX", "Dallas"]);
    expect(params.getAll("label[]")).toEqual(["Austin, TX", "Dallas"]);
    expect(params.has("label")).toBe(false);
  });

  it("reads key[] over the comma form when both happen to be present", () => {
    const params = new URLSearchParams("label=A,B&label%5B%5D=Austin%2C+TX&label%5B%5D=Dallas");
    expect(readFilterList(params, "label")).toEqual(["Austin, TX", "Dallas"]);
  });

  it("round-trips a value containing a comma without corrupting it", () => {
    const params = new URLSearchParams();
    writeFilterList(params, "label", ["Austin, TX"]);
    expect(readFilterList(params, "label")).toEqual(["Austin, TX"]);
  });
});

describe("useUrlFilters", () => {
  it("defaults to 'all' range and empty lists with no URL params", () => {
    const { result } = renderHook(() => useUrlFilters(), { wrapper });
    expect(result.current.filters).toEqual({
      range: "all",
      customRange: { from: "", to: "" },
      channels: [],
      labels: [],
      platforms: [],
      selection: [],
      brk: "",
      brkf: [],
      cols: null,
    });
  });

  it("round-trips channels through setFilters", () => {
    const { result } = renderHook(() => useUrlFilters(), { wrapper });
    act(() => result.current.setFilters({ channels: ["Display", "Video"] }));
    expect(result.current.filters.channels).toEqual(["Display", "Video"]);
  });

  it("round-trips a custom range and clears from/to when range leaves 'custom'", () => {
    const { result } = renderHook(() => useUrlFilters(), { wrapper });
    act(() => result.current.setFilters({ range: "custom", customRange: { from: "2026-08-01", to: "2026-08-10" } }));
    expect(result.current.filters).toMatchObject({ range: "custom", customRange: { from: "2026-08-01", to: "2026-08-10" } });
    act(() => result.current.setFilters({ range: "all" }));
    expect(result.current.filters.customRange).toEqual({ from: "", to: "" });
  });

  it("normalizes a reversed custom range (from > to)", () => {
    const { result } = renderHook(() => useUrlFilters(), { wrapper });
    act(() => result.current.setFilters({ customRange: { from: "2026-08-10", to: "2026-08-01" } }));
    expect(result.current.filters.customRange).toEqual({ from: "2026-08-01", to: "2026-08-10" });
  });

  it("round-trips repeated brkf params and selection", () => {
    const { result } = renderHook(() => useUrlFilters(), { wrapper });
    // Two separate act()s, one per user action - setSearchParams' functional updater is only
    // guaranteed to see the previous call's result once React has flushed the transition between
    // them, exactly like two separate clicks in the real UI (never two calls batched into one).
    act(() => result.current.setFilters({ brk: "tactic", brkf: ["tactic:a", "audience:b"] }));
    act(() => result.current.setFilters({ selection: ["100", "200"] }));
    expect(result.current.filters.brk).toBe("tactic");
    expect(result.current.filters.brkf).toEqual(["tactic:a", "audience:b"]);
    expect(result.current.filters.selection).toEqual(["100", "200"]);
  });

  it("cols is null when absent, and a real list once set", () => {
    const { result } = renderHook(() => useUrlFilters(), { wrapper });
    expect(result.current.filters.cols).toBeNull();
    act(() => result.current.setFilters({ cols: ["conv", "pcConv"] }));
    expect(result.current.filters.cols).toEqual(["conv", "pcConv"]);
  });

  it("clearing every filter returns to the same default shape", () => {
    const { result } = renderHook(() => useUrlFilters(), { wrapper });
    act(() => {
      result.current.setFilters({
        channels: ["Display"],
        labels: ["brand"],
        platforms: ["TTD"],
        selection: ["1"],
        brk: "tactic",
        brkf: ["tactic:a"],
        range: "custom",
        customRange: { from: "2026-08-01", to: "2026-08-10" },
      });
    });
    act(() => {
      result.current.setFilters({
        range: "all",
        customRange: { from: "", to: "" },
        channels: [],
        labels: [],
        platforms: [],
        selection: [],
        brk: "",
        brkf: [],
      });
    });
    expect(result.current.filters).toEqual({
      range: "all",
      customRange: { from: "", to: "" },
      channels: [],
      labels: [],
      platforms: [],
      selection: [],
      brk: "",
      brkf: [],
      cols: null,
    });
  });
});
