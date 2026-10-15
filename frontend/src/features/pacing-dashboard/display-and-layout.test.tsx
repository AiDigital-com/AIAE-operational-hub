/**
 * Settings → Display (Pacing's gallery and Library, moved) and Layout mode (moved), over the whole
 * page: the moved screens, the state seam they read, and the page's wiring around them can each be
 * wrong on their own.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aPacingDashboardV1,
  aPacingLibraryEntryV1,
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

function renderPage() {
  vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1());
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

async function openDisplay() {
  await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
  await userEvent.click(await screen.findByRole("button", { name: "Display" }));
  await screen.findByText("Page sections");
}

/** jsdom has no matchMedia; Layout mode is offered from 900 px up, so the tests that use it say so. */
function wideScreen() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("Settings → Display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([
      aPacingLibraryEntryV1({ id: "std:v2:daily", name: "Daily Performance" }),
    ]);
  });

  it("should offer the six scratch starts behind «+ Add widget»", async () => {
    renderPage();
    await openDisplay();

    await userEvent.click(screen.getByRole("button", { name: "+ Add widget" }));

    expect(screen.getByText("Start from scratch")).toBeInTheDocument();
    for (const label of ["Blank widget", "Chart", "Table", "KPI", "Pie", "Compare"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("should open the Library as its own screen, and have no History door", async () => {
    renderPage();
    await openDisplay();

    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Library" }));

    expect(await screen.findByText("Daily Performance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to the gallery" })).toBeInTheDocument();
  });
});

describe("Layout mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([]);
    wideScreen();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("should swap the board for the editor, and Cancel back with nothing saved", async () => {
    renderPage();
    await waitFor(() => expect(document.querySelector('[data-tile-id="lineItems"]')).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Layout mode" }));

    // The editor's hint bar: Save is inert until something moves.
    const save = await screen.findByRole("button", { name: "Save layout" });
    expect(save).toBeDisabled();
    expect(document.querySelector(".lm-grid")).toBeTruthy();
    // The filter bar stays on screen, inert, and carries neither action meanwhile.
    expect(screen.queryByRole("button", { name: "Layout mode" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(document.querySelector(".lm-grid")).toBeNull());
    expect(screen.getByRole("button", { name: "Layout mode" })).toBeInTheDocument();
    expect(api.savePacingDisplay).not.toHaveBeenCalled();
  });

  it("should not offer Layout mode on a narrow screen", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderPage();
    const settings = await screen.findByRole("button", { name: "Settings" });

    expect(within(settings.parentElement as HTMLElement).queryByRole("button", { name: "Layout mode" })).toBeNull();
  });
});
