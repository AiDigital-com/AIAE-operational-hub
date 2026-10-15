/**
 * Settings → Display → «Page sections» (Pacing's BlockLibrary.jsx, moved): the four code-rendered
 * sections, each with an on/off switch that saves the instant it is flipped, plus the Line Items
 * card's «Show description», which rides the drawer's Save.
 *
 * Asserted over the whole page, the way `spa/lineitems/line-item-settings.test.tsx` is: the switch,
 * the save lane, the cached payload and the section that hides can each be wrong on their own.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aPacingDashboardCampaignV1,
  aPacingDashboardV1,
  aPacingLibraryEntryV1,
  aPacingLineItemPlanV1,
  aPacingRefreshStatusV1,
  aPacingRowV1,
} from "@/test/factories";
import * as api from "./api";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { PacingDashboard } from "./pacing-dashboard";

vi.mock("./api", () => ({
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

function renderPage(payload: Payload = {}) {
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

async function openWidgetsTab() {
  await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
  await userEvent.click(await screen.findByRole("button", { name: "Display" }));
  await screen.findByText("Page sections");
}

const journalPanel = () => document.querySelector(".journal-panel");

/** A pacing whose flight has not started: the Launch Plan's own condition for being on the page. */
function notStarted(display: Record<string, unknown> = { rev: 1, widgets: [] }): Payload {
  const plan = aPacingLineItemPlanV1({ lineItemId: "70123", flightStart: "2099-01-01", flightEnd: "2099-01-31" });
  return {
    campaign: aPacingDashboardCampaignV1({ startDate: "2099-01-01", endDate: "2099-01-31" }),
    planByLineItem: { "70123": plan },
    factsDaily: [],
    display: display as never,
  };
}

describe("Page sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([aPacingLibraryEntryV1()]);
  });

  it("should list the four sections, each with its switch", async () => {
    renderPage();
    await openWidgetsTab();

    for (const name of ["Launch Plan", "Alerts", "Line Items", "Journal"]) {
      expect(await screen.findByRole("switch", { name })).toBeChecked();
    }
    expect(screen.getByText("Switches apply for everyone immediately.")).toBeInTheDocument();
  });

  it("should save a switch the moment it is flipped, alone, and hide the section", async () => {
    // Given
    vi.mocked(api.savePacingDisplay).mockResolvedValue({
      status: "saved",
      display: { rev: 2, widgets: [], enabled: { journal: false } },
    });
    renderPage();
    await waitFor(() => expect(journalPanel()).toBeTruthy());
    await openWidgetsTab();

    // When
    await userEvent.click(await screen.findByRole("switch", { name: "Journal" }));

    // Then: one save holding nothing but the entry - the per-entry lane - with no Save pressed.
    await waitFor(() => expect(api.savePacingDisplay).toHaveBeenCalledTimes(1));
    const [, sent, rev] = vi.mocked(api.savePacingDisplay).mock.calls[0];
    expect(sent).toEqual({ enabled: { journal: false } });
    // The per-entry lane: no revision, as in Pacing - dash-gate merges the one entry.
    expect(rev).toBeUndefined();
    await waitFor(() => expect(journalPanel()).toBeNull());
    expect(screen.getByRole("switch", { name: "Journal" })).not.toBeChecked();
  });

  it("should send null to turn a section back on", async () => {
    vi.mocked(api.savePacingDisplay).mockResolvedValue({ status: "saved", display: { rev: 2, widgets: [], enabled: {} } });
    renderPage({ display: { rev: 1, widgets: [], enabled: { journal: false } } as never });
    await openWidgetsTab();
    expect(journalPanel()).toBeNull();

    await userEvent.click(await screen.findByRole("switch", { name: "Journal" }));

    await waitFor(() => expect(api.savePacingDisplay).toHaveBeenCalled());
    expect(vi.mocked(api.savePacingDisplay).mock.calls[0][1]).toEqual({ enabled: { journal: null } });
    await waitFor(() => expect(journalPanel()).toBeTruthy());
  });

  it("should keep a switch flipped behind the drawer when the drawer is saved", async () => {
    // Given: Journal switched off, then «Show description» ticked in the same drawer.
    vi.mocked(api.savePacingDisplay)
      .mockResolvedValueOnce({ status: "saved", display: { rev: 2, widgets: [], enabled: { journal: false } } })
      .mockResolvedValueOnce({ status: "saved", display: {} });
    renderPage();
    await openWidgetsTab();
    await userEvent.click(await screen.findByRole("switch", { name: "Journal" }));
    await waitFor(() => expect(api.savePacingDisplay).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("checkbox", { name: "Show description" }));

    // When
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: the full save goes out under the revision the switch left, and leaves the on/off map
    // out altogether, as Pacing's does - dash-gate keeps the stored one, so nothing is rewound.
    await waitFor(() => expect(api.savePacingDisplay).toHaveBeenCalledTimes(2));
    const [, sent, rev] = vi.mocked(api.savePacingDisplay).mock.calls[1];
    expect(rev).toBe(2);
    expect(sent).toMatchObject({ showDescription: true });
    expect(sent).not.toHaveProperty("enabled");
  });

  it("should turn Line Items off from its ⋯, through the same lane", async () => {
    vi.mocked(api.savePacingDisplay).mockResolvedValue({
      status: "saved",
      display: { rev: 2, widgets: [], enabled: { lineItems: false } },
    });
    renderPage();
    await waitFor(() => expect(document.querySelector('[data-tile-id="lineItems"]')).toBeTruthy());

    await userEvent.click(await screen.findByRole("button", { name: "Block actions: Line Items" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Turn off" }));

    await waitFor(() => expect(api.savePacingDisplay).toHaveBeenCalled());
    expect(vi.mocked(api.savePacingDisplay).mock.calls[0][1]).toEqual({ enabled: { lineItems: false } });
    await waitFor(() => expect(document.querySelector('[data-tile-id="lineItems"]')).toBeNull());
  });
});

describe("Alerts and Journal on the board", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([aPacingLibraryEntryV1()]);
  });

  /** A line that delivered 1 000 impressions for $50 on day one: behind plan, so it has alerts. */
  function withAlerts(): Payload {
    const plan = aPacingLineItemPlanV1({ lineItemId: "70123" });
    return {
      planByLineItem: { "70123": plan },
      factsDaily: [{ date: "2026-08-01", line_item_id: "70123", impressions: 1000, clicks: 10, spend: 50 }] as never,
    };
  }

  /** A tile's row on the board. */
  const rowOf = (id: string) => Number((document.querySelector(`[data-tile-id="${id}"]`) as HTMLElement).style.gridRow);

  it("should place them as Pacing does: Alerts above Line Items, the journal last", async () => {
    renderPage(withAlerts());
    await waitFor(() => expect(document.querySelector('[data-tile-id="journal"]')).toBeTruthy());

    expect(document.querySelector('[data-tile-id="alerts"]')).toBeTruthy();
    expect(rowOf("alerts")).toBeLessThan(rowOf("lineItems"));
    expect(rowOf("lineItems")).toBeLessThan(rowOf("journal"));
    expect(journalPanel()?.closest('[data-tile-id="journal"]')).toBeTruthy();
  });

  it("should turn a section off from its corner ⋯", async () => {
    vi.mocked(api.savePacingDisplay).mockResolvedValue({
      status: "saved",
      display: { rev: 2, widgets: [], enabled: { alerts: false } },
    });
    renderPage(withAlerts());
    await waitFor(() => expect(document.querySelector('[data-tile-id="alerts"]')).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Block actions: Alerts" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Turn off" }));

    await waitFor(() => expect(api.savePacingDisplay).toHaveBeenCalled());
    expect(vi.mocked(api.savePacingDisplay).mock.calls[0][1]).toEqual({ enabled: { alerts: false } });
    await waitFor(() => expect(document.querySelector('[data-tile-id="alerts"]')).toBeNull());
  });
});

describe("Launch Plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([aPacingLibraryEntryV1()]);
  });

  it("should show the launch recommendations before the flight starts", async () => {
    renderPage(notStarted());
    expect(await screen.findByText("Launch recommendations")).toBeInTheDocument();
    // An even split: 1 000 000 impressions over 31 days.
    expect(screen.getAllByText("32,258").length).toBeGreaterThan(0);
  });

  it("should not be on the page once the flight has delivered", async () => {
    renderPage({
      factsDaily: [{ date: "2026-08-01", line_item_id: "x", impressions: 1, clicks: 0, spend: 0 }] as never,
    });
    await waitFor(() => expect(document.querySelector('[data-tile-id="lineItems"]')).toBeTruthy());
    expect(screen.queryByText("Launch recommendations")).toBeNull();
  });

  it("should not be on the page when switched off", async () => {
    renderPage(notStarted({ rev: 1, widgets: [], enabled: { launchPlan: false } }));
    await waitFor(() => expect(document.querySelector('[data-tile-id="lineItems"]')).toBeTruthy());
    expect(screen.queryByText("Launch recommendations")).toBeNull();
  });
});
