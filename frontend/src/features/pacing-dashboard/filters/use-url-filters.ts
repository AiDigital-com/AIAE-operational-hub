/**
 * Ported from the retired SPA's `workspace/src/hooks/useUrlFilters.js` (104 lines) - byte-for-byte
 * the same URL encoding, translated to TypeScript against `react-router-dom` v7's `useSearchParams`
 * (same API the reference used). Kept as a faithful port, not a rewrite: the list-encoding quirk
 * (explicit `key[]` params when a value contains a comma, else a comma-joined `key`) exists so one
 * label containing a comma does not break an old shared link, and changing the encoding would break
 * exactly the links it protects.
 */
import { useCallback, useMemo, startTransition } from "react";
import { useSearchParams } from "react-router-dom";
import type { DashboardFilters } from "./types";

function normalizeCustomRange(from: string, to: string): { from: string; to: string } {
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}

/** Explicit array keys distinguish one label containing a comma from old shared links whose single
 *  value was a comma-separated list. */
export function readFilterList(params: URLSearchParams, key: string): string[] {
  return params.has(`${key}[]`)
    ? params.getAll(`${key}[]`).filter(Boolean)
    : (params.get(key)?.split(",").filter(Boolean) ?? []);
}

export function writeFilterList(params: URLSearchParams, key: string, values: string[] | undefined): void {
  params.delete(key);
  params.delete(`${key}[]`);
  const list = (values ?? []).filter(Boolean);
  if (list.some((value) => value.includes(","))) {
    for (const value of list) params.append(`${key}[]`, value);
  } else if (list.length) {
    params.set(key, list.join(","));
  }
}

/** A patch to `setFilters` - every field optional; an omitted field is left untouched in the URL. */
export type DashboardFiltersPatch = Partial<DashboardFilters>;

export interface UseUrlFiltersResult {
  filters: DashboardFilters;
  setFilters: (patch: DashboardFiltersPatch) => void;
}

export function useUrlFilters(): UseUrlFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();

  const filters = useMemo<DashboardFilters>(() => {
    const params = new URLSearchParams(searchKey);
    const customRange = normalizeCustomRange(params.get("from") ?? "", params.get("to") ?? "");
    // cols: comma-separated visible column keys. null = not in URL (fall back to display config).
    const colsRaw = params.get("cols");
    const cols = colsRaw ? colsRaw.split(",").filter(Boolean) : null;

    return {
      range: params.get("range") ?? "all",
      customRange,
      channels: readFilterList(params, "ch"),
      labels: readFilterList(params, "label"),
      platforms: readFilterList(params, "platform"),
      selection: params.get("li")?.split(",").filter(Boolean) ?? [],
      brk: params.get("brk") ?? "",
      brkf: params.getAll("brkf").filter(Boolean),
      cols,
    };
  }, [searchKey]);

  const setFilters = useCallback(
    (patch: DashboardFiltersPatch) => {
      // Wrap the URL update in startTransition so heavy downstream metric recomputation doesn't
      // block the click handler that triggered it.
      startTransition(() => {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            if (patch.range !== undefined) {
              if (patch.range === "all") next.delete("range");
              else next.set("range", patch.range);
              if (patch.range !== "custom") {
                next.delete("from");
                next.delete("to");
              }
            }
            if (patch.customRange !== undefined) {
              const normalized = normalizeCustomRange(patch.customRange.from || "", patch.customRange.to || "");
              if (normalized.from) next.set("from", normalized.from);
              else next.delete("from");
              if (normalized.to) next.set("to", normalized.to);
              else next.delete("to");
            }
            if (patch.channels !== undefined) writeFilterList(next, "ch", patch.channels);
            if (patch.labels !== undefined) writeFilterList(next, "label", patch.labels);
            if (patch.platforms !== undefined) writeFilterList(next, "platform", patch.platforms);
            if (patch.selection !== undefined) {
              if (patch.selection.length) next.set("li", patch.selection.join(","));
              else next.delete("li");
            }
            if (patch.brk !== undefined) {
              if (patch.brk) next.set("brk", patch.brk);
              else next.delete("brk");
            }
            if (patch.brkf !== undefined) {
              next.delete("brkf");
              for (const v of patch.brkf ?? []) {
                if (v) next.append("brkf", v);
              }
            }
            if (patch.cols !== undefined) {
              if (Array.isArray(patch.cols) && patch.cols.length > 0) next.set("cols", patch.cols.join(","));
              else next.delete("cols");
            }

            return next.toString() === prev.toString() ? prev : next;
          },
          { replace: true }
        );
      });
    },
    [setSearchParams]
  );

  return { filters, setFilters };
}
