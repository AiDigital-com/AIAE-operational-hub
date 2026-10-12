import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { PacingWidgetsSection } from "./widgets-section";
import type { SettingsSectionHandle } from "./settings-section";
import type { PacingDisplayShape } from "./types";

vi.mock("./api", () => ({ savePacingDisplay: vi.fn() }));

// The library itself is a moved screen with its own tests; what is under test here is the DRAFT
// the section holds and the one imperative action the mapping screen reaches it through.
vi.mock("./pacing-dashboard-library", () => ({
  PacingDashboardLibrary: () => null,
}));

function mount(display: PacingDisplayShape) {
  const ref = createRef<SettingsSectionHandle>();
  render(
    <PacingWidgetsSection
      ref={ref}
      slug="nike-ss26"
      display={display}
      capabilities={undefined}
      isAdmin
      libraryEntries={undefined}
      seedKey={1}
      onDirtyChange={vi.fn()}
    />,
  );
  return ref;
}

const TABLE = { kind: "table", title: "App/URL", rows: { dim: "ds:apps:app_url" } };

describe("PacingWidgetsSection.addWidget", () => {
  it("mints a tile for an axis nothing is showing yet", () => {
    const ref = mount({ widgets: [], groups: [], enabled: {} } as unknown as PacingDisplayShape);
    const id = ref.current?.addWidget?.(TABLE);
    expect(id).toBeTruthy();
  });

  it("returns the tile already reading that axis instead of a second copy of it", () => {
    // "Create a table of the top 20" is a button a person presses again whenever they come back to
    // the column - it says nothing about whether one exists. Without this, every press minted
    // another identical table until the cap, and the mapping screen gave no sign of it.
    const display = {
      widgets: [{ id: "w7", kind: "table", rows: { dim: "ds:apps:app_url" } }],
      groups: [],
      enabled: {},
    } as unknown as PacingDisplayShape;
    const ref = mount(display);
    expect(ref.current?.addWidget?.(TABLE)).toBe("w7");
  });

  it("reads the axis off a chart's xAxis too", () => {
    const display = {
      widgets: [{ id: "w3", kind: "bar", xAxis: { dim: "ds:apps:app_url" } }],
      groups: [],
      enabled: {},
    } as unknown as PacingDisplayShape;
    const ref = mount(display);
    expect(ref.current?.addWidget?.(TABLE)).toBe("w3");
  });

  it("does not take two different axes for the same tile", () => {
    const display = {
      widgets: [{ id: "w1", kind: "table", rows: { dim: "ds:apps:publisher" } }],
      groups: [],
      enabled: {},
    } as unknown as PacingDisplayShape;
    const ref = mount(display);
    const id = ref.current?.addWidget?.(TABLE);
    expect(id).toBeTruthy();
    expect(id).not.toBe("w1");
  });

  it("still refuses past the cap, and does not mistake a dimensionless tile for a match", () => {
    const widgets = Array.from({ length: 64 }, (_, i) => ({ id: `w${i}`, kind: "metric" }));
    const ref = mount({ widgets, groups: [], enabled: {} } as unknown as PacingDisplayShape);
    expect(ref.current?.addWidget?.(TABLE)).toBeNull();
  });
});
