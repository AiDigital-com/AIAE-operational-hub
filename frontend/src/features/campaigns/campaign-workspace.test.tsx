import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../shared/api/api-error";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { getCampaign } from "./api";
import { listCampaignAccessContacts, type CampaignAccessContactsV1 } from "./shares-api";
import type { CampaignV1 } from "./types";
import { CampaignTabRedirect, CampaignWorkspace } from "./campaign-workspace";

vi.mock("./api", () => ({
  getCampaign: vi.fn(),
}));
// The hero's "people" control has its own tests; here it only needs to answer rather than throw.
vi.mock("./shares-api", () => ({
  listCampaignShares: vi.fn().mockResolvedValue({ canShare: false, shares: [] }),
  listShareCandidates: vi.fn().mockResolvedValue([]),
  createCampaignShare: vi.fn(),
  deleteCampaignShare: vi.fn(),
  listCampaignAccessContacts: vi.fn(),
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

function anAccessAnswer(): CampaignAccessContactsV1 {
  return {
    campaignName: "Alexandra Williams for OUSD 6",
    netSuiteTeamLeads: ["Sam Marley"],
    runningTeamFound: true,
    contacts: [
      {
        hubUserId: 380,
        fullName: "Saveliy Maslakov",
        email: "sam.marley@aidigital.com",
        roleName: "MPO Team Lead",
        teamName: "Media Optimization: Saveliy",
      },
      {
        hubUserId: 167,
        fullName: "Anna Motorina",
        email: "anna.motorina@aidigital.com",
        roleName: "MPO Manager",
        teamName: "Media Optimization: Saveliy",
      },
    ],
  };
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
    expect(screen.getByRole("link", { name: "Netsuite" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Reporting" })).not.toHaveAttribute("aria-current");
  });

  it("should offer every tab, including Pacing, now that all of them read real data", () => {
    // Given/When: §5 of the migration plan wired Pacing to real Pacing-service data, same as
    // Dashboards before it - no tab is mock-only any more, so none is hidden from the nav.
    renderWorkspace("/campaigns/42/setup", FULL_STATE);

    // Then:
    expect(screen.getByRole("link", { name: "Pacing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboards" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^(Netsuite|Pacing|Reporting|Dashboards)$/ })).toHaveLength(4);
  });

  it("should render a tab's content reached by a direct link", () => {
    // Given/When: a bookmark, or a tab the session stored on a prior visit
    renderWorkspace("/campaigns/42/pacing", FULL_STATE);

    // Then:
    expect(screen.getByText("Pacing content")).toBeInTheDocument();
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

  it("should name the team that runs the campaign and keep its people folded", async () => {
    // Given: the Hub answers 404 for a campaign this user can't see, and resolves NetSuite's lead to a team
    vi.mocked(getCampaign).mockRejectedValue(new ApiError("Unknown campaign: 42.", 404));
    vi.mocked(listCampaignAccessContacts).mockResolvedValue(anAccessAnswer());
    const user = userEvent.setup();

    // When:
    renderWorkspace("/campaigns/42/pacing", undefined);

    // Then: one line about the team, nobody listed yet
    expect(await screen.findByText(/In NetSuite it’s run by Sam Marley’s team\./)).toBeInTheDocument();
    expect(screen.getByText("You don’t have access to this campaign.")).toBeInTheDocument();
    expect(screen.queryByText("Saveliy Maslakov")).not.toBeInTheDocument();
    expect(screen.queryByText(/Media Optimization: Saveliy/)).not.toBeInTheDocument();
    expect(listCampaignAccessContacts).toHaveBeenCalledExactlyOnceWith(42);

    // When: the people are unfolded
    await user.click(screen.getByRole("button", { name: "Show 2 people" }));

    // Then: the lead first, with role and email
    const people = screen.getAllByRole("listitem");
    expect(within(people[0]).getByText("Saveliy Maslakov")).toBeInTheDocument();
    expect(within(people[0]).getByText("MPO Team Lead")).toBeInTheDocument();
    expect(within(people[0]).getByText("sam.marley@aidigital.com")).toBeInTheDocument();
    expect(within(people[1]).getByText("Anna Motorina")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide people" })).toHaveAttribute("aria-expanded", "true");
  });

  it("should show the ready message with the campaign name and link, and copy it", async () => {
    // Given:
    vi.mocked(getCampaign).mockRejectedValue(new ApiError("Unknown campaign: 42.", 404));
    vi.mocked(listCampaignAccessContacts).mockResolvedValue(anAccessAnswer());
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderWorkspace("/campaigns/42/pacing", undefined);

    // Then: the message itself is on screen, addressed to the team
    expect(await screen.findByText("Send this to someone on the team in Slack:")).toBeInTheDocument();
    expect(
      screen.getByText(/Hi! Could you add me to the campaign “Alexandra Williams for OUSD 6” through Add people/)
    ).toBeInTheDocument();

    // When:
    await user.click(screen.getByRole("button", { name: "Copy message" }));

    // Then:
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("add me to the campaign “Alexandra Williams for OUSD 6” through Add people")
    );
    expect(writeText.mock.calls[0][0]).toContain("/campaigns/42/pacing");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy message" })).not.toBeInTheDocument();
  });

  it("should ask to copy by hand when the clipboard refuses", async () => {
    // Given:
    vi.mocked(getCampaign).mockRejectedValue(new ApiError("Unknown campaign: 42.", 404));
    vi.mocked(listCampaignAccessContacts).mockResolvedValue(anAccessAnswer());
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    renderWorkspace("/campaigns/42/pacing", undefined);

    // When:
    await user.click(await screen.findByRole("button", { name: "Copy message" }));

    // Then:
    expect(await screen.findByText("Could not copy. Select the text above and copy it yourself.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
  });

  it("should name the agency's team leads when NetSuite's lead resolves to no team", async () => {
    // Given:
    vi.mocked(getCampaign).mockRejectedValue(new ApiError("Unknown campaign: 42.", 404));
    vi.mocked(listCampaignAccessContacts).mockResolvedValue({
      ...anAccessAnswer(),
      netSuiteTeamLeads: ["Nino Jincharadze"],
      runningTeamFound: false,
    });

    // When:
    renderWorkspace("/campaigns/42/pacing", undefined);

    // Then:
    expect(await screen.findByText(/In NetSuite it is assigned to Nino Jincharadze\./)).toBeInTheDocument();
    expect(screen.getByText(/Any of these team leads can add you/)).toBeInTheDocument();
    expect(screen.getByText("Send this to one of them in Slack:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 2 people" })).toBeInTheDocument();
  });

  it("should send the user to an admin when NetSuite's lead has no team in the Hub", async () => {
    // Given:
    vi.mocked(getCampaign).mockRejectedValue(new ApiError("Unknown campaign: 42.", 404));
    vi.mocked(listCampaignAccessContacts).mockResolvedValue({
      campaignName: "Alexandra Williams for OUSD 6",
      netSuiteTeamLeads: ["Nino Jincharadze"],
      runningTeamFound: false,
      contacts: [],
    });

    // When:
    renderWorkspace("/campaigns/42/pacing", undefined);

    // Then:
    expect(await screen.findByText(/assigned to Nino Jincharadze, whose team is not set up/)).toBeInTheDocument();
    expect(screen.getByText(/Ask an admin to give you access\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy message" })).not.toBeInTheDocument();
  });

  it("should fall back to the general explanation when nobody can be named", async () => {
    // Given: the lookup fails (e.g. the id is unknown altogether)
    vi.mocked(getCampaign).mockRejectedValue(new ApiError("Unknown campaign: 42.", 404));
    vi.mocked(listCampaignAccessContacts).mockRejectedValue(new ApiError("Unknown campaign: 42.", 404));

    // When:
    renderWorkspace("/campaigns/42/pacing", undefined);

    // Then:
    expect(await screen.findByText("It may belong to another team, or it may not be shared with you.")).toBeInTheDocument();
    expect(screen.getByText("You don’t have access to this campaign.")).toBeInTheDocument();
    expect(screen.getByText("Ask the MPO manager for this campaign to share it with you.")).toBeInTheDocument();
    expect(screen.queryByText(/Unknown campaign/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to Agencies" })).not.toBeInTheDocument();
  });

  it("should show a way back instead of a broken hero when the campaign can't be fetched", async () => {
    // Given: any other failure, e.g. the Hub is down
    vi.mocked(getCampaign).mockRejectedValue(new Error("Campaign 42 was not found."));

    // When:
    renderWorkspace("/campaigns/42/pacing", undefined);

    // Then:
    expect(await screen.findByText(/Campaign 42 was not found\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Agencies" })).toHaveAttribute("href", "/agencies");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});
