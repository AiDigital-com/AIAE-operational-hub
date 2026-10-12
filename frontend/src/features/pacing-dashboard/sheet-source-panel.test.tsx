import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SheetSources } from "./sheet-source-panel";
import { topNWidgetFor } from "./spa/sheet-source-norm.js";
import { tileTitle } from "./widgets/widget-tiles";
import type { PacingSheetDimSource } from "./types";

vi.mock("./api", () => ({
  probePacingSheet: vi.fn(),
  readPacingDimSource: vi.fn(),
  readPacingDimSourceValues: vi.fn(),
  suggestPacingDimSource: vi.fn(),
}));

import { probePacingSheet } from "./api";

const probe = vi.mocked(probePacingSheet);

const LINE_ITEMS = [
  { id: "695344", label: "LI 695344" },
  { id: "695346", label: "LI 695346" },
];

/** A source already connected but with no column roles yet - the resumable half-state. */
const CONNECTED: PacingSheetDimSource = {
  id: "apps",
  loader: "sheet",
  title: "Apps (pacing)",
  origin: {
    spreadsheet_id: "18k4mKFw8etLr1ME4S4cy2ZEhG7ITHbWx9n5I5xgEFEo",
    sheet_id: 0,
    title: "Source",
    header_row: 0,
    columns: null,
  },
  binding: { mode: "id_in_name", map: {}, exclude: [] },
};

/** The same source, fully mapped. */
const MAPPED: PacingSheetDimSource = {
  ...CONNECTED,
  origin: {
    ...CONNECTED.origin,
    columns: {
      date: "Date",
      line_item: "Line Item",
      dims: [{ key: "app_url", label: "App/URL", column: "App/URL" }],
      metrics: { im: "Impressions" },
    },
  },
};

function renderPanel(
  sources: PacingSheetDimSource[],
  extra: Record<string, unknown> = {},
) {
  const onChange = (extra.onChange as ReturnType<typeof vi.fn>) ?? vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SheetSources
        slug="nike-ss26"
        sources={sources}
        stored={sources}
        loaded={{}}
        lineItems={LINE_ITEMS}
        {...extra}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

/**
 * This panel is a SEAM, not a screen: connecting a sheet, showing what one last read and mapping its
 * columns are components moved from the retired SPA, and their behaviour is theirs to keep. What is
 * tested here is the wiring - which screen is on show, what reaches the list, and that the draft
 * handed back is the one the caller will save.
 */
describe("SheetSources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    probe.mockResolvedValue({ readable: true, spreadsheetId: "abc", title: "", tabs: [] } as never);
  });

  it("says what a sheet source is for when there is none", () => {
    renderPanel([]);
    expect(screen.getByText(/adds a breakdown the delivery tables do not carry/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ Add source/i })).toBeTruthy();
  });

  it("shows one block per connected source", () => {
    renderPanel([MAPPED, { ...MAPPED, id: "clicks", title: "Clickdata" }]);
    expect(screen.getAllByRole("button", { name: /re-read now/i })).toHaveLength(2);
    expect(screen.getByText(/Apps \(pacing\)/)).toBeTruthy();
    expect(screen.getByText(/Clickdata/)).toBeTruthy();
  });

  it("removes one source and leaves the others alone", async () => {
    const onChange = renderPanel([MAPPED, { ...MAPPED, id: "clicks", title: "Clickdata" }]);
    // Two clicks, not one: the first turns the button into "Remove?" - disconnecting a source takes
    // its rows off every screen that used them, which is not a thing to do on a stray click.
    fireEvent.click(screen.getAllByRole("button", { name: /^remove$/i })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^remove\?$/i })[0]);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = onChange.mock.calls[0][0] as PacingSheetDimSource[];
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("clicks");
  });

  it("opens the mapping editor on the source whose block asked", async () => {
    renderPanel([MAPPED]);
    fireEvent.click(screen.getByRole("button", { name: /open mapping/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /all sources/i })).toBeTruthy());
    // The list is gone: one screen at a time, which is what makes the back button mean something.
    expect(screen.queryByRole("button", { name: /re-read now/i })).toBeNull();
  });

  it("comes back to the list from the editor", async () => {
    renderPanel([MAPPED]);
    fireEvent.click(screen.getByRole("button", { name: /open mapping/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /all sources/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /all sources/i }));
    expect(screen.getByRole("button", { name: /\+ Add source/i })).toBeTruthy();
  });

  it("opens the connect flow, and comes back from it", async () => {
    renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: /\+ Add source/i }));
    // The chooser first: which of the three kinds. "Additional data" is this panel's own.
    await waitFor(() => expect(screen.getByRole("radio", { name: /additional data/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByRole("button", { name: /\+ Add source/i })).toBeTruthy();
  });

  it("will not offer a re-read of a source whose mapping is unsaved", () => {
    // Re-read goes to the server, which reads the SAVED mapping - so on an edited source it would
    // re-read with the OLD mapping and report success. The action is absent rather than disabled,
    // and the block says why instead.
    renderPanel([MAPPED], { stored: [CONNECTED] });
    expect(screen.queryByRole("button", { name: /re-read now/i })).toBeNull();
    expect(screen.getByText(/not saved yet/i)).toBeTruthy();
  });

  it("offers a re-read once what is on screen is what is stored", () => {
    renderPanel([MAPPED], { stored: [MAPPED] });
    expect(screen.getByRole("button", { name: /re-read now/i })).toBeTruthy();
  });

  /**
   * The editor calls back with `(source, dim)`, and `dim` is the whole COLUMN ENTRY. Both halves
   * matter and neither is type-checked across the JS boundary: a `(dim, source)` handler compiles,
   * then builds a widget whose `title` is a source OBJECT, and the first tile that renders it
   * throws on `title.trim()` and takes the page white. That is what this reproduces - with a real
   * read behind it, because the button is dead until the source is saved and its breakdown ready.
   */
  it("hands the create-widget callback the source and the column entry, in that order", async () => {
    const onCreateWidget = vi.fn();
    const rows = Array.from({ length: 60 }, (_, i) => ({ dims: { app_url: `app-${i}.example` } }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SheetSources
          slug="nike-ss26"
          sources={[MAPPED]}
          stored={[MAPPED]}
          loaded={{ apps: { rows, breakdowns: { app_url: "ready" } } }}
          lineItems={LINE_ITEMS}
          openIndex={0}
          onCreateWidget={onCreateWidget}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const button = await screen.findByRole("button", { name: /create a table of the top 20/i });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    expect(onCreateWidget).toHaveBeenCalledTimes(1);
    const [source, dim] = onCreateWidget.mock.calls[0];
    expect(source.id).toBe("apps");
    expect(dim).toMatchObject({ key: "app_url", label: "App/URL" });

    // And the pair actually builds a drawable tile: a title a tile can print, on the right axis.
    const widget = topNWidgetFor(source, dim, 20);
    expect(widget.title).toBe("App/URL");
    expect(widget.rows.dim).toBe("ds:apps:app_url");
    expect(tileTitle(widget as { title?: string }, null)).toBe("App/URL");
  });

  it("links to the file it reads", () => {
    renderPanel([MAPPED]);
    const link = screen.getByRole("link", { name: /open sheet/i }) as HTMLAnchorElement;
    expect(link.href).toContain(String(MAPPED.origin?.spreadsheet_id));
  });
});
