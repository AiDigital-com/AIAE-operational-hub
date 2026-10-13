/**
 * The «See in Breakdown» handoff through the store seam. `useReportControls.js` reads and clears it
 * with `useDashboardStore.getState()`, outside a render, and trusts that read to be current - the
 * store, not a stale closure, decides which of two offering tiles took the axis first.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - moved JS from Pacing's SPA, deliberately untyped (see SOURCE.md)
import { bindDimensionHandoff, setDimensionHandoff, useDashboardStore } from "./store.js";

afterEach(() => setDimensionHandoff(null));

describe("the dimension handoff", () => {
  it("is read back at once, and the page is told so it re-renders the tiles", () => {
    // Given:
    const notify = vi.fn();
    const unbind = bindDimensionHandoff(notify);

    // When:
    setDimensionHandoff("ds:src1:language");

    // Then:
    expect(useDashboardStore.getState().dimensionHandoff).toBe("ds:src1:language");
    expect(notify).toHaveBeenLastCalledWith("ds:src1:language");
    unbind();
  });

  it("is spent by the tile that takes it, through the same getState", () => {
    // Given:
    setDimensionHandoff("ds:src1:language");

    // When: what useReportControls does once a tile has taken the axis
    useDashboardStore.getState().setDimensionHandoff(null);

    // Then:
    expect(useDashboardStore.getState().dimensionHandoff).toBeNull();
  });

  it("stops telling a page that has unbound", () => {
    // Given:
    const notify = vi.fn();
    bindDimensionHandoff(notify)();

    // When:
    setDimensionHandoff("ds:src1:geo");

    // Then:
    expect(notify).not.toHaveBeenCalled();
  });
});
