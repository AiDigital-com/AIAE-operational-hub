import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingLibraryEntryV1 } from "@/test/factories";
import * as api from "./api";
import { PacingDashboardLibrary } from "./pacing-dashboard-library";
import type { PacingDisplayShape } from "./types";
// Moved JS from Pacing's SPA: the card thumbnails draw through Pacing's own renderer now, which
// reads its figures from this provider — so the panel cannot be mounted without one.
import { PacingStateProvider } from "./spa/store.js";
// @ts-expect-error - moved JS
import { stdEntry } from "./spa/std-catalog.js";
// @ts-expect-error - moved JS
import { buildFactsAggregates } from "./spa/normalize.js";

/** The smallest state a thumbnail can draw from. One line item, two days. */
const FACTS = [
  { date: "2026-03-01", line_item_id: "700001", impressions: 1000, clicks: 10, spend: 50 },
  { date: "2026-03-02", line_item_id: "700001", impressions: 2000, clicks: 30, spend: 90 },
];
const LI_PLAN = {
  700001: { id: "700001", ch: "Display", dsp: null, rateType: "CPM", budget: 1000,
            planImpr: 100000, mTgt: 20, ctrTgt: 1, vcrTgt: 0, fs: "2026-03-01", fe: "2026-03-31", containers: [] },
};
const AGG = buildFactsAggregates(FACTS, 1, LI_PLAN);
const PREVIEW_STATE = {
  campaign: { id: "c1", name: "P", currency: "USD", rate: 1, startDate: "2026-03-01", endDate: "2026-03-31" },
  facts: { factsDaily: FACTS, liDaily: AGG.LD, liSplitDaily: AGG.LSD, asOf: AGG.asOf, rate: 1, cvCtx: null },
  liPlan: LI_PLAN,
  types: [], creatives: null, conversions: null, conversionTags: null,
  // Empty MAPS, not null: the engine's `selectAvailDims` walks these, and the widget builder the
  // Edit action opens reads it on mount. Null used to be tolerated and is not any more.
  availableSplits: {}, availableMetrics: { delivery: ["im", "cl", "sp"] },
  dataConfig: { source: "platform_mart" }, dimSources: null,
  mappingsV3: null, thirdParty: null, notify: null, display: {},
  journalHighlight: null, dimensionHandoff: null, selectedPeriodKey: null,
  splitScopedMode: false, splitScopedPlans: null,
  urlFilters: { filters: { range: "all", customRange: null, channels: [], labels: [], platforms: [], selection: [], brk: "", brkf: [], cols: null }, setFilters: () => {} },
  actions: { saveSettings: async () => {} },
};

vi.mock("./api", () => ({
  listPacingLibrary: vi.fn(),
  createPacingLibraryEntry: vi.fn(),
  updatePacingLibraryEntry: vi.fn(),
  deletePacingLibraryEntry: vi.fn(),
  setPacingLibraryLike: vi.fn(),
}));

function renderPanel(display: PacingDisplayShape, overrides: Partial<Parameters<typeof PacingDashboardLibrary>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSave = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <PacingStateProvider value={PREVIEW_STATE}>
      <PacingDashboardLibrary
        display={display}
        saving={false}
        saveError={null}
        onSave={onSave}
        isAdmin={false}
        libraryEntries={undefined}
        {...overrides}
      />
      </PacingStateProvider>
    </QueryClientProvider>
  );
  return { onSave };
}

describe("PacingDashboardLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should add a library widget onto this pacing's own widgets, linked by lib.key (US-116)", async () => {
    // Given:
    vi.mocked(api.listPacingLibrary).mockResolvedValue([
      aPacingLibraryEntryV1({ id: "e1", name: "Budget card", kind: "widget", definition: { profile: "card", schemaVersion: 2, datasetType: "delivery" } }),
    ]);
    const { onSave } = renderPanel({ widgets: [] });
    await screen.findByText("Budget card");

    // When:
    await userEvent.click(screen.getByRole("button", { name: /add/i }));

    // Then: a fresh widget instance links back to the library entry, so usage-counting sees it
    expect(onSave).toHaveBeenCalledTimes(1);
    const patch = onSave.mock.calls[0][0];
    expect(patch.widgets).toHaveLength(1);
    expect(patch.widgets[0].lib).toEqual({ src: "user", key: "e1" });
  });

  it("should remove a widget from only this pacing, not from the shared library", async () => {
    // Given:
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    const { onSave } = renderPanel({ widgets: [{ id: "w_abc123", title: "My widget" }] });
    await screen.findByText("My widget");

    // When:
    await userEvent.click(screen.getByRole("button", { name: /remove my widget/i }));

    // Then: and the on/off map loses its entry with it, so a stale off-switch cannot attach itself
    // to a later widget that happens to reuse the id.
    expect(onSave).toHaveBeenCalledWith({ widgets: [], groups: [], enabled: {} });
  });

  it("should save a widget to the shared library with a name and description (US-118)", async () => {
    // Given:
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    vi.mocked(api.createPacingLibraryEntry).mockResolvedValue({ status: "saved", result: aPacingLibraryEntryV1() });
    renderPanel({ widgets: [{ id: "w_abc123", title: "My widget" }] });
    await screen.findByText("My widget");

    // When:
    // Icon-only at card width; the words are on the label, which is what a reader hears anyway.
    await userEvent.click(screen.getByRole("button", { name: /save .* to library/i }));
    await screen.findByRole("dialog");
    await userEvent.clear(screen.getByLabelText(/^name/i));
    await userEvent.type(screen.getByLabelText(/^name/i), "Shared budget widget");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // Then:
    await waitFor(() =>
      expect(api.createPacingLibraryEntry).toHaveBeenCalledWith(
        "widget", "Shared budget widget", undefined, expect.objectContaining({ id: "w_abc123" })
      )
    );
  });

  it("should report a concurrent edit rather than silently overwrite it (US-118)", async () => {
    // Given:
    const entry = aPacingLibraryEntryV1({ id: "e1", updatedAt: "t2" });
    vi.mocked(api.listPacingLibrary).mockResolvedValue([entry]);
    vi.mocked(api.deletePacingLibraryEntry).mockResolvedValue({
      status: "conflict",
      conflict: { reason: "stale_entry", currentUpdatedAt: "t3" },
    });
    renderPanel({ widgets: [] }, { isAdmin: false });
    const item = await screen.findByText(entry.name);
    const row = item.closest("li") as HTMLElement;

    // When:
    await userEvent.click(within(row).getByLabelText(/remove from library/i));

    // Then:
    await screen.findByText(/someone else changed this library entry/i);
  });

  it("should draw what a widget looks like, not only what it is called", async () => {
    // A name says nothing about a widget - "Delivery, Pacing & Margin" is several different
    // templates - so a list of names asks the reader to remember, or to add one and find out.
    //
    // The card draws through the SAME renderer the board does (Pacing's `ReportWidget`, in preview
    // mode), which is the property this asserts: a TABLE widget used to show "Unsupported view kind"
    // here while the page drew a real table. Pacing's own Standard definition, not a hand-made spec.
    //
    // jsdom performs no layout, so every box reports zero width and the thumbnail - which scales its
    // content to the cell it measures - would have nothing to scale to. The measurement is supplied
    // here; it is the browser's job everywhere else.
    const realRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect(this: Element) {
      return { ...realRect.call(this), width: 240, height: 132 } as DOMRect;
    };
    try {
      vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
      const daily = stdEntry("std:v2:daily") as { definition: Record<string, unknown> };
      renderPanel({ widgets: [{ id: "w_daily01", ...structuredClone(daily.definition) }] });

      await waitFor(() => {
        expect(document.querySelector(".pdl__prev table")).toBeTruthy();
      });
      expect(screen.queryByText(/Unsupported view kind/i)).not.toBeInTheDocument();
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
    }
  });

  it("should say why a linked widget has no picture rather than showing an empty frame", async () => {
    // Given: a linked instance whose library entry is gone. It carries no spec of its own - the
    // entry IS the definition - so there is nothing to draw.
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    renderPanel({ widgets: [{ id: "w_abc123", title: "Linked tile", lib: { src: "user", key: "missing" } }] });

    // Then: the card still lists it so it can be removed, and says why
    expect(await screen.findByText(/library entry is no longer available/)).toBeInTheDocument();
    expect(screen.getByText("Linked tile")).toBeInTheDocument();
  });

  it("should turn a widget off by storing false, and back on by removing the entry", async () => {
    // Given:
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    const { onSave } = renderPanel({ widgets: [{ id: "w_abc123", title: "My widget" }] });
    await screen.findByText("My widget");
    const control = screen.getByRole("switch", { name: /show my widget on the dashboard/i });

    // When: turned off
    expect(control).toHaveAttribute("aria-checked", "true");
    await userEvent.click(control);

    // Then: the widget itself is untouched - it is hidden, not removed
    expect(onSave).toHaveBeenCalledWith({
      widgets: [{ id: "w_abc123", title: "My widget" }],
      groups: [],
      enabled: { w_abc123: false },
    });

    // When: turned back on, from a display that already carries the off entry
    const again = renderPanel({
      widgets: [{ id: "w_abc123", title: "My widget" }],
      enabled: { w_abc123: false },
    });
    await userEvent.click(screen.getAllByRole("switch", { name: /show my widget on the dashboard/i })[1]);

    // Then: the entry is DELETED rather than written as `true` - absent ≡ on
    expect(again.onSave).toHaveBeenCalledWith(expect.objectContaining({ enabled: {} }));
  });

  it("should mark a switched-off card so dimming is not the only thing that says so", async () => {
    // A widget with no data to draw looks dim too, so the word is what separates the two.
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    renderPanel({ widgets: [{ id: "w_abc123", title: "My widget" }], enabled: { w_abc123: false } });

    expect(await screen.findByText("off")).toBeInTheDocument();
  });

  it("should duplicate a widget beside the original, as an independent copy", async () => {
    // Given: a LINKED instance. Its definition lives in the library entry, not in the instance.
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    const { onSave } = renderPanel(
      { widgets: [{ id: "w_aaa111", title: "Delivery", lib: { src: "user", key: "e1" } }, { id: "w_bbb222" }] },
      {
        libraryEntries: {
          e1: { definition: { kind: "composite", schemaVersion: 2, profile: "card", spec: { views: [] } } },
        },
      }
    );
    await screen.findByText("Delivery");

    // When:
    await userEvent.click(screen.getByRole("button", { name: /duplicate delivery/i }));

    // Then: the copy carries what the tile DRAWS - copying the bare ref would make a widget with
    // nothing in it - and is private: no link back to the entry, no provenance.
    const patch = onSave.mock.calls[0][0];
    expect(patch.widgets.map((w: { id: string }) => w.id)).toEqual(["w_aaa111", expect.any(String), "w_bbb222"]);
    const copy = patch.widgets[1];
    expect(copy.title).toBe("Delivery (copy)");
    expect(copy.spec).toEqual({ views: [] });
    expect(copy.lib).toBeUndefined();
    // And it does not join any group the original was in - a frame is an arrangement someone built.
    expect(patch.groups).toEqual([]);
  });

  it("should open the widget builder on a tile and fold its edits into the draft", async () => {
    // The end of the port: Pacing's own builder, opened from this panel, reporting a change that
    // lands in the SAME draft the library list holds - so the drawer's one Save commits both. It
    // writes nothing itself; `onSave` here is the drawer's draft setter, not the network.
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    const daily = stdEntry("std:v2:daily") as { definition: Record<string, unknown> };
    const { onSave } = renderPanel({
      widgets: [{ id: "w_daily01", ...structuredClone(daily.definition) }],
    });

    await userEvent.click(await screen.findByRole("button", { name: /^edit /i }));

    // The builder is really there - its own title field, not just a panel that swapped.
    const title = await screen.findByPlaceholderText(/widget title/i);
    // Deterministic for the reason spelled out in spa/builder-loads.test.tsx.
    fireEvent.change(title, { target: { value: "Edited" } });

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const patch = onSave.mock.calls.at(-1)![0];
    expect(patch.widgets).toHaveLength(1);
    expect(patch.widgets[0].id).toBe("w_daily01");
    // Editing DETACHES: the builder hands back a definition, and keeping a `lib` ref beside it
    // would claim the tile still follows an entry it no longer matches.
    expect(patch.widgets[0].lib).toBeUndefined();
  });

  it("should keep a title's trailing space, so a multi-word name can be typed at all", async () => {
    // The draft is fed BACK into the panel on every keystroke, which is what makes this reachable:
    // whatever the panel does to the title on the way into the editor happens between two letters.
    // Resolving it through the display helper trims it - and a space is always trailing at the
    // moment you type it, so every space died on arrival and a title could never grow past one word.
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    const daily = stdEntry("std:v2:daily") as { definition: Record<string, unknown> };

    function Host() {
      const [display, setDisplay] = useState<PacingDisplayShape>({
        widgets: [{ id: "w_daily01", ...structuredClone(daily.definition) }],
      });
      return (
        <PacingDashboardLibrary
          display={display}
          saving={false}
          saveError={null}
          onSave={(patch) => setDisplay((d) => ({ ...d, ...patch }))}
          isAdmin={false}
          libraryEntries={undefined}
        />
      );
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PacingStateProvider value={PREVIEW_STATE}>
          <Host />
        </PacingStateProvider>
      </QueryClientProvider>
    );

    await userEvent.click(await screen.findByRole("button", { name: /^edit /i }));
    const title = await screen.findByPlaceholderText(/widget title/i) as HTMLInputElement;
    // Deterministic for the reason spelled out in spa/builder-loads.test.tsx.
    fireEvent.change(title, { target: { value: "Two" } });
    fireEvent.change(title, { target: { value: "Two " } });
    await waitFor(() => expect(title.value).toBe("Two "));
    fireEvent.change(title, { target: { value: "Two words" } });
    await waitFor(() => expect(title.value).toBe("Two words"));
  });

  it("should refuse to duplicate a linked tile whose library entry is gone", async () => {
    // There is no definition to copy, only the broken ref - copying it would put a SECOND
    // unavailable tile on the dashboard.
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    renderPanel({ widgets: [{ id: "w_abc123", title: "Linked tile", lib: { src: "user", key: "missing" } }] });
    await screen.findByText("Linked tile");

    const button = screen.getByRole("button", { name: /duplicate linked tile/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/library entry is unavailable/i));
  });
});
