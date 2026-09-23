import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingLibraryEntryV1 } from "@/test/factories";
import * as api from "./api";
import { PacingDashboardLibrary } from "./pacing-dashboard-library";
import type { PacingDisplayShape } from "./types";

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
      <PacingDashboardLibrary
        display={display}
        saving={false}
        saveError={null}
        onSave={onSave}
        isAdmin={false}
        // The thumbnails render through the real engine; with no metrics they draw "No data",
        // which is what a pacing with no delivery shows and is not what these cases are about.
        renderCtx={{ brickCtx: { metrics: null }, metrics: null }}
        libraryEntries={undefined}
        {...overrides}
      />
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

    // Then:
    expect(onSave).toHaveBeenCalledWith({ widgets: [], groups: [] });
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
    // Given: a tile on this pacing, and the figures the dashboard itself renders with. A name says
    // nothing about a widget - "Delivery, Pacing & Margin" is several different templates - so a
    // list of names asks the reader to remember, or to add one and find out.
    //
    // jsdom performs no layout, so every box reports zero width and the thumbnail - which scales
    // its content to the cell it measures - would have nothing to scale to. The measurement is
    // supplied here; it is the browser's job everywhere else.
    const realRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect(this: Element) {
      return { ...realRect.call(this), width: 240, height: 132 } as DOMRect;
    };
    try {
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    renderPanel(
      {
        widgets: [
          {
            id: "w_abc123",
            kind: "composite",
            title: "Margin",
            profile: "card",
            spec: { views: [{ kind: "layout", rows: [{ cols: [{ span: 12, bricks: [
              { type: "bigStat", label: "Margin", bind: { metric: "margin" }, format: "percent" },
            ] }] }] }] },
          },
        ],
      },
      {
        renderCtx: {
          brickCtx: {
            metrics: {
              bound: { [JSON.stringify({ metric: "margin" })]: { value: 84.41, target: 71.94 } },
            },
          },
          metrics: null,
        } as never,
      }
    );

    // Then: the card carries the figure the tile would draw, through the same engine
    expect(await screen.findByText("84.41%")).toBeInTheDocument();
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
});
