/**
 * The Line Items block's settings, its value-group member rows, and CPI on its split rows.
 *
 *   - `display.lineItems` (Pacing commit `85d353c`): which metric cells a card and its split rows
 *     print and in what order, how the cards are sorted, the view the block opens on, and how many
 *     rows show before "Show all". Edited from the tile's ⋯ → Customize…, which opens the settings
 *     drawer on the block's own card, and saved with the drawer's one Save.
 *   - Value groups (Pacing commit `a33ba97`): a dim split whose value is one of the line's groups
 *     carries an "N values" toggle and opens into its members, each with its own delivery.
 *   - CPI is OURS (Pacing has no such rate type): an install-paced line's split rows count
 *     conversions and price them per install, as the line's own card does.
 *
 * Asserted over the whole page, the way `line-items.test.tsx` beside this explains: the payload,
 * the state seam, the moved maths and the markup can each be wrong on their own.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aPacingDashboardV1,
  aPacingLibraryEntryV1,
  aPacingLineItemPlanV1,
  aPacingRefreshStatusV1,
  aPacingRowV1,
} from "@/test/factories";
import * as api from "../../api";
import { ToastProvider } from "../../../../shared/ui/toast/toast";
import { PacingDashboard } from "../../pacing-dashboard";

vi.mock("../../api", () => ({
  getPacingDashboard: vi.fn(),
  savePacingCampaignLinks: vi.fn(),
  getPacingRefreshStatus: vi.fn(),
  triggerPacingRefresh: vi.fn(),
  savePacingDisplay: vi.fn(),
  savePacingPeriodScope: vi.fn(),
  listPacingLibrary: vi.fn(),
  createPacingLibraryEntry: vi.fn(),
  updatePacingLibraryEntry: vi.fn(),
  deletePacingLibraryEntry: vi.fn(),
  setPacingLibraryLike: vi.fn(),
}));

type Payload = Parameters<typeof aPacingDashboardV1>[0];

function renderPage(payload: Payload) {
  vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1(payload));
  vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <PacingDashboard row={aPacingRowV1()} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/** The block's tile on the board. */
async function block() {
  return waitFor(() => {
    const el = document.querySelector('[data-tile-id="lineItems"]');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
}

/** A card's expand chevron. A click on the row itself SELECTS the line item; the chevron opens it. */
function chevronOf(row: Element) {
  const el = row.querySelector('svg[class*="cursor-pointer"]');
  expect(el).toBeTruthy();
  return el as Element;
}

/** The metric labels one row prints, in order - the first line of each cell after the identity. */
function rowLabels(row: Element, labelSelector: string) {
  return [...row.querySelectorAll(labelSelector)].map((el) => el.textContent?.trim() ?? "");
}

const SETTINGS = (over: Record<string, unknown>) => ({
  columns: ["margin", "spend", "units", "pacing", "rate"],
  sort: { key: "default", dir: "asc" },
  view: "all",
  rows: 6,
  ...over,
});

/** Line items on two channels with delivery, one of them carrying a period split. */
function twoLines() {
  const display = aPacingLineItemPlanV1({
    lineItemId: "70123",
    channel: "Display",
    containers: [
      {
        id: "c1",
        name: "Initial",
        fs: "2026-08-01",
        fe: "2026-08-31",
        target_impressions: 500_000,
        date_children: [{ id: "d1", fs: "2026-08-01", fe: "2026-08-15", target_impressions: 250_000 }],
        dim_children: [],
      },
    ] as never,
  });
  const video = aPacingLineItemPlanV1({ lineItemId: "70124", channel: "Video" });
  return {
    planByLineItem: { "70123": display, "70124": video },
    factsDaily: [
      { date: "2026-08-01", line_item_id: "70123", impressions: 100_000, clicks: 100, spend: 500 },
      { date: "2026-08-01", line_item_id: "70124", impressions: 300_000, clicks: 90, spend: 1_200 },
    ] as never,
  };
}

describe("Line Items settings (display.lineItems)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([aPacingLibraryEntryV1()]);
  });

  it("should print today's five cells when nothing is stored", async () => {
    renderPage(twoLines());
    const tile = await block();
    const row = await waitFor(() => {
      const r = tile.querySelector(".li-row");
      expect(r?.textContent).toMatch(/LI 70123/);
      return r as HTMLElement;
    });
    expect(row.style.getPropertyValue("--li-cols") || (row.parentElement as HTMLElement).style.getPropertyValue("--li-cols")).toBe("5");
    expect(row.textContent).toMatch(/Spend \/ Cost Bud\./);
  });

  it("should print the stored columns, in their order, on the card and on its split rows", async () => {
    renderPage({ ...twoLines(), display: { rev: 1, widgets: [], lineItems: SETTINGS({ columns: ["ctr", "spend", "daysLeft"] }) } as never });
    const tile = await block();
    const row = await waitFor(() => {
      const r = [...tile.querySelectorAll(".li-row")].find((el) => /LI 70123/.test(el.textContent ?? ""));
      expect(r).toBeTruthy();
      return r as HTMLElement;
    });
    // Three metric cells, and the card root carries the count the split rows share.
    expect((row.parentElement as HTMLElement).style.getPropertyValue("--li-cols")).toBe("3");
    const text = row.textContent ?? "";
    expect(text.indexOf("CTR")).toBeGreaterThan(-1);
    expect(text.indexOf("CTR")).toBeLessThan(text.indexOf("Spend / Cost Bud."));
    expect(text.indexOf("Spend / Cost Bud.")).toBeLessThan(text.indexOf("Days left"));
    expect(text).not.toMatch(/Margin/);

    // The split row prints one cell per column, so its cells sit under the card's. CTR and Days
    // left have no split reading: they keep their place and print a dash.
    await userEvent.click(chevronOf(row));
    const split = await waitFor(() => {
      const s = tile.querySelector(".sp-row");
      expect(s).toBeTruthy();
      return s as HTMLElement;
    });
    // ("Spend" alone: this period carries no budget of its own to prorate against.)
    expect(rowLabels(split, ".sp-ml")).toEqual(["CTR", "Spend", "Days left"]);
  });

  it("should sort the cards by the stored key", async () => {
    // Video spent 1 200 against Display's 500: spend, descending, puts it first.
    renderPage({ ...twoLines(), display: { rev: 1, widgets: [], lineItems: SETTINGS({ sort: { key: "spend", dir: "desc" } }) } as never });
    const tile = await block();
    await waitFor(() => expect(tile.querySelectorAll(".li-row")).toHaveLength(2));
    const ids = [...tile.querySelectorAll(".li-row")].map((r) => (/LI (\d{5})/.exec(r.textContent ?? "") ?? [])[1]);
    expect(ids).toEqual(["70124", "70123"]);
  });

  it("should open on the stored default view, and still let the viewer switch", async () => {
    renderPage({ ...twoLines(), display: { rev: 1, widgets: [], lineItems: SETTINGS({ view: "byChannel" }) } as never });
    const tile = await block();
    await waitFor(() => expect(tile.querySelectorAll(".lis-ch-head")).toHaveLength(2));

    await userEvent.click(within(tile).getByRole("button", { name: "All lines" }));
    await waitFor(() => expect(tile.querySelectorAll(".lis-ch-head")).toHaveLength(0));
  });

  it("should show the stored number of rows before Show all", async () => {
    const plans = Object.fromEntries(
      ["1", "2", "3", "4"].map((n) => [`7000${n}`, aPacingLineItemPlanV1({ lineItemId: `7000${n}` })])
    );
    renderPage({ planByLineItem: plans, factsDaily: [] as never, display: { rev: 1, widgets: [], lineItems: SETTINGS({ rows: 3 }) } as never });
    const tile = await block();
    await waitFor(() => expect(tile.querySelectorAll(".li-row")).toHaveLength(3));
    expect(within(tile).getByRole("button", { name: "Show all (4)" })).toBeInTheDocument();
  });

  it("should open the block's settings from its ⋯ and save them with the drawer's Save", async () => {
    vi.mocked(api.savePacingDisplay).mockResolvedValue({ status: "saved", display: {} });
    renderPage(twoLines());
    await block();

    await userEvent.click(await screen.findByRole("button", { name: "Block actions: Line Items" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Customize…" }));

    // The drawer opens on the block's card with its editor already expanded.
    const editor = await waitFor(() => {
      const el = document.getElementById("lic-editor");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // Today's six (Conv among them: the card drops it only while the pacing has no conversions).
    expect(within(editor).getByText("6 of 8")).toBeInTheDocument();

    // Add the CTR column and save.
    await userEvent.click(within(editor).getByRole("checkbox", { name: /^CTR/ }));
    expect(within(editor).getByText("7 of 8")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.savePacingDisplay).toHaveBeenCalled());
    const [, sent] = vi.mocked(api.savePacingDisplay).mock.calls.at(-1)!;
    expect((sent as { lineItems: unknown }).lineItems).toEqual(
      SETTINGS({ columns: ["margin", "spend", "units", "pacing", "rate", "conv", "ctr"] })
    );
  });

  it("should send null for Reset to default, so the stored key is deleted", async () => {
    vi.mocked(api.savePacingDisplay).mockResolvedValue({ status: "saved", display: {} });
    renderPage({ ...twoLines(), display: { rev: 1, widgets: [], lineItems: SETTINGS({ rows: 12 }) } as never });
    await block();

    await userEvent.click(await screen.findByRole("button", { name: "Block actions: Line Items" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Customize…" }));
    const editor = await waitFor(() => document.getElementById("lic-editor") as HTMLElement);
    await userEvent.click(within(editor).getByRole("button", { name: "Reset to default" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.savePacingDisplay).toHaveBeenCalled());
    const [, sent] = vi.mocked(api.savePacingDisplay).mock.calls.at(-1)!;
    expect(sent).toHaveProperty("lineItems", null);
  });
});

/** A line whose geo split «South» is a value group of TX and FL, and a plain split on CA. */
function groupedLine(rateType = "CPM") {
  const plan = aPacingLineItemPlanV1({
    lineItemId: "70123",
    rateType,
    dimGroups: [{ dim_key: "geo", name: "South", values: ["TX", "FL"] }],
    containers: [
      {
        id: "c1",
        name: "Geo",
        fs: "2026-08-01",
        fe: "2026-08-31",
        target_impressions: 500_000,
        date_children: [],
        dim_children: [
          { id: "g1", dim_key: "geo", dim_value: "South", target_mode: "absolute", target_value: 300_000, target_spend: 3_000 },
          { id: "g2", dim_key: "geo", dim_value: "CA", target_mode: "absolute", target_value: 200_000, target_spend: 2_000 },
        ],
      },
    ],
  } as never);
  const row = (geo: string, impressions: number, spend: number, conversions: number) => ({
    date: "2026-08-02", line_item_id: "70123", geo, impressions, clicks: impressions / 100, spend, conversions,
  });
  return {
    planByLineItem: { "70123": plan },
    factsDaily: [row("TX", 60_000, 300, 30), row("FL", 40_000, 200, 10), row("CA", 50_000, 250, 5)] as never,
  };
}

async function openFirstCard() {
  const tile = await block();
  const row = await waitFor(() => {
    const r = tile.querySelector(".li-row");
    expect(r?.textContent).toMatch(/LI 70123/);
    return r as HTMLElement;
  });
  await userEvent.click(chevronOf(row));
  await waitFor(() => expect(tile.querySelectorAll(".sp-row").length).toBeGreaterThan(0));
  return tile;
}

/** A split row by the name it prints. */
function splitRow(tile: HTMLElement, name: string) {
  return [...tile.querySelectorAll(".sp-row:not(.sp-row--member)")].find((r) =>
    (r.querySelector(".sp-nm")?.textContent ?? "").includes(name)
  ) as HTMLElement | undefined;
}

/** A row's value cell under a given column label. */
function valueUnder(row: Element, label: string) {
  const cell = [...row.children].find((c) => c.querySelector(".sp-ml")?.textContent?.trim() === label);
  return cell?.querySelector(".sp-mv")?.textContent?.trim();
}

describe("Value group members on a split row (a33ba97)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([aPacingLibraryEntryV1()]);
  });

  it("should carry an 'N values' toggle on a group's row, and none on a plain value", async () => {
    renderPage(groupedLine());
    const tile = await openFirstCard();

    const south = await waitFor(() => {
      const r = splitRow(tile, "South");
      expect(r).toBeTruthy();
      return r as HTMLElement;
    });
    const toggle = within(south).getByRole("button", { name: /2 values/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("title", "South = TX, FL");
    expect(within(splitRow(tile, "CA") as HTMLElement).queryByRole("button", { name: /values/ })).toBeNull();
    expect(tile.querySelectorAll(".sp-row--member")).toHaveLength(0);
  });

  it("should open into its members, each with its own delivery, adding up to the group's row", async () => {
    renderPage(groupedLine());
    const tile = await openFirstCard();
    const south = await waitFor(() => splitRow(tile, "South") as HTMLElement);
    expect(valueUnder(south, "Impressions")).toBe("100,000");

    await userEvent.click(within(south).getByRole("button", { name: /2 values/ }));

    const members = [...tile.querySelectorAll(".sp-row--member")];
    // Largest first.
    expect(members.map((m) => m.querySelector(".sp-nm")?.textContent)).toEqual(["TX", "FL"]);
    expect(members.map((m) => valueUnder(m, "Impressions"))).toEqual(["60,000", "40,000"]);
    expect(members[0].textContent).toMatch(/60% of South/);
    // Delivery only: no plan side, no pacing bar.
    for (const m of members) expect(m.textContent).not.toMatch(/expected|pror\.|tgt/);

    await userEvent.click(within(south).getByRole("button", { name: /2 values/ }));
    expect(tile.querySelectorAll(".sp-row--member")).toHaveLength(0);
  });
});

describe("CPI on split rows (ours - the reference has no CPI)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([aPacingLibraryEntryV1()]);
  });

  it("should count installs (conversions) and price them per install, on the row and on its members", async () => {
    renderPage(groupedLine("CPI"));
    const tile = await openFirstCard();
    const south = await waitFor(() => splitRow(tile, "South") as HTMLElement);

    // 30 + 10 conversions, not the 100 000 impressions; $500 / 40 = $12.50 per install.
    expect(valueUnder(south, "Installs")).toBe("40");
    expect(valueUnder(south, "CPI")).toBe("$12.50");

    await userEvent.click(within(south).getByRole("button", { name: /2 values/ }));
    const members = [...tile.querySelectorAll(".sp-row--member")];
    expect(members.map((m) => m.querySelector(".sp-nm")?.textContent)).toEqual(["TX", "FL"]);
    expect(members.map((m) => valueUnder(m, "Installs"))).toEqual(["30", "10"]);
    // $300 / 30 and $200 / 10.
    expect(members.map((m) => valueUnder(m, "CPI"))).toEqual(["$10.00", "$20.00"]);
  });

  it("should print the line's cost per install in the card's own CPI cell", async () => {
    renderPage(groupedLine("CPI"));
    const tile = await block();
    const row = await waitFor(() => {
      const r = tile.querySelector(".li-row");
      expect(r?.textContent).toMatch(/LI 70123/);
      return r as HTMLElement;
    });
    // $750 over 45 conversions = $16.67, not the line's CPM ($5.00).
    const cell = [...row.children].find((c) => c.textContent?.trim().startsWith("CPI"));
    expect(cell?.textContent).toMatch(/\$16\.67/);
  });
});
