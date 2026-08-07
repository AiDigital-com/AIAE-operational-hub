import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { getCampaign } from "./api";
import type { CampaignV1 } from "./types";
import { CampaignTabRedirect, CampaignWorkspace } from "./campaign-workspace";

vi.mock("./api", () => ({
  getCampaign: vi.fn(),
}));

interface WorkspaceState {
  campaign?: CampaignV1;
  agencyId?: number;
  agencyName?: string;
  clientId?: number;
  clientName?: string;
}

function aCampaign(overrides: Partial<CampaignV1> = {}): CampaignV1 {
  return {
    id: 42,
    name: "Ourisman Ford 2026",
    status: "Live",
    start_date: "2026-01-12",
    end_date: "2026-12-31",
    budget: 1250000,
    channels: ["Display", "Video"],
    industry_vertical: "Automotive",
    ...overrides,
  };
}

function renderWorkspace(initialPath: string, state: WorkspaceState | undefined = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[{ pathname: initialPath, state }]}>
          <Routes>
            <Route path="/campaigns/:campaignId" element={<CampaignWorkspace />}>
              <Route index element={<CampaignTabRedirect />} />
              <Route path="pacing" element={<div>Pacing content</div>} />
              <Route path="setup" element={<div>Setup content</div>} />
              <Route path="reporting" element={<div>Reporting content</div>} />
              <Route path="dashboards" element={<div>Dashboards content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const FULL_STATE: WorkspaceState = {
  campaign: aCampaign(),
  agencyId: 1,
  agencyName: "Blue Chair",
  clientId: 7,
  clientName: "Ourisman Ford",
};

describe("CampaignWorkspace", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("should render the hero with title, status, and flight dates", () => {
    // Given/When:
    renderWorkspace("/campaigns/42/pacing", FULL_STATE);

    // Then:
    expect(screen.getByRole("heading", { level: 1, name: "Ourisman Ford 2026" })).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText(/Jan 12, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Blue Chair · Ourisman Ford")).toBeInTheDocument();
  });

  it("should highlight the active tab from the URL", () => {
    // Given/When:
    renderWorkspace("/campaigns/42/setup", FULL_STATE);

    // Then:
    expect(screen.getByRole("link", { name: "Setup" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Reporting" })).not.toHaveAttribute("aria-current");
  });

  it("should not offer Pacing or Dashboards as nav tabs (hidden for now - mock data only)", () => {
    // Given/When:
    renderWorkspace("/campaigns/42/setup", FULL_STATE);

    // Then:
    expect(screen.queryByRole("link", { name: "Pacing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dashboards" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^(Setup|Reporting)$/ })).toHaveLength(2);
  });

  it("should still render a hidden tab reached by a direct link", () => {
    // Given/When: a bookmark or a tab the session stored before it left the nav
    renderWorkspace("/campaigns/42/dashboards", FULL_STATE);

    // Then: hidden from the nav is not the same as removed
    expect(screen.getByText("Dashboards content")).toBeInTheDocument();
  });

  it("should switch tab content when a different tab is clicked, without a full page navigation", async () => {
    // Given:
    renderWorkspace("/campaigns/42/pacing", FULL_STATE);
    expect(screen.getByText("Pacing content")).toBeInTheDocument();

    // When:
    await userEvent.click(screen.getByRole("link", { name: "Reporting" }));

    // Then:
    expect(screen.getByText("Reporting content")).toBeInTheDocument();
    expect(screen.queryByText("Pacing content")).not.toBeInTheDocument();
    // The hero (rendered by the same, un-remounted layout) is still there
    expect(screen.getByRole("heading", { level: 1, name: "Ourisman Ford 2026" })).toBeInTheDocument();
  });

  it("should default to Reporting when no tab has been stored for this session yet", () => {
    // Given/When: the bare campaign URL, with no prior tab visit
    renderWorkspace("/campaigns/42", FULL_STATE);

    // Then:
    expect(screen.getByText("Reporting content")).toBeInTheDocument();
  });

  it("should redirect to the last tab stored for this campaign in this session", () => {
    // Given:
    sessionStorage.setItem("oph.campaign-tab.42", "setup");

    // When:
    renderWorkspace("/campaigns/42", FULL_STATE);

    // Then:
    expect(screen.getByText("Setup content")).toBeInTheDocument();
  });

  it("should persist the active tab to the session when a tab is visited", () => {
    // Given/When:
    renderWorkspace("/campaigns/42/reporting", FULL_STATE);

    // Then:
    expect(sessionStorage.getItem("oph.campaign-tab.42")).toBe("reporting");
  });

  it("should show the breadcrumb trail including the active tab", () => {
    // Given/When:
    renderWorkspace("/campaigns/42/dashboards", FULL_STATE);

    // Then:
    const crumbs = document.querySelector(".campaign-ws__crumbs") as HTMLElement;
    expect(within(crumbs).getByText("Blue Chair")).toBeInTheDocument();
    expect(within(crumbs).getByRole("link", { name: "Ourisman Ford" }))
      .toHaveAttribute("href", "/agencies/1/clients/7?clientName=Ourisman%20Ford");
    expect(within(crumbs).getByText("Ourisman Ford 2026")).toBeInTheDocument();
    expect(within(crumbs).getByText("Dashboards")).toBeInTheDocument();
  });

  it("should never request the campaign it was already handed via router state", () => {
    // Given/When: opened from a list, which carries the campaign along
    renderWorkspace("/campaigns/42/pacing", FULL_STATE);

    // Then: re-fetching it would duplicate data the caller already has
    expect(getCampaign).not.toHaveBeenCalled();
  });

  it("should fetch the campaign by id when there is no router state (a pasted deep link)", async () => {
    // Given: no router state at all
    vi.mocked(getCampaign).mockResolvedValue(aCampaign({ name: "Summer Camp Promo" }));

    // When:
    renderWorkspace("/campaigns/42/pacing", undefined);

    // Then:
    expect(await screen.findByRole("heading", { level: 1, name: "Summer Camp Promo" })).toBeInTheDocument();
    expect(screen.getByText("Pacing content")).toBeInTheDocument();
    expect(getCampaign).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("should show a loading indicator while a deep-linked campaign is being fetched", () => {
    // Given:
    vi.mocked(getCampaign).mockReturnValue(new Promise(() => {}));

    // When:
    renderWorkspace("/campaigns/42/pacing", undefined);

    // Then:
    expect(screen.getByRole("status", { name: "Loading campaign" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("should show a way back instead of a broken hero when the campaign can't be fetched", async () => {
    // Given: e.g. an id that doesn't exist, or one outside this user's visibility
    vi.mocked(getCampaign).mockRejectedValue(new Error("Campaign 42 was not found."));

    // When:
    renderWorkspace("/campaigns/42/pacing", undefined);

    // Then:
    expect(await screen.findByText(/Campaign 42 was not found\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Agencies" })).toHaveAttribute("href", "/agencies");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});
