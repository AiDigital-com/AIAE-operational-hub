import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingCreateResultV1, aPacingDraftLineItemV1, aPacingDraftV1, aPacingNsDiffReportV1, aUserV1 } from "@/test/factories";
import { ToastProvider } from "../../../shared/ui/toast/toast";
import { getPacingNsDiff, listCampaignPacings } from "../../pacing-overview/api";
import type { PacingListResponseV1, PacingRowV1 } from "../../pacing-overview/types";
import * as pacingDashboardApi from "../../pacing-dashboard/api";
import * as pacingCreateApi from "../../pacing-create/api";
import { deletePacing, revalidatePacing } from "../../pacing-admin/api";
import { getCurrentUser } from "../../rbac/api";
import type { CampaignTabContext } from "../campaign-workspace";
import type { CampaignV1 } from "../types";
import { PacingTab } from "./pacing-tab";

vi.mock("../../pacing-overview/api", () => ({
  listCampaignPacings: vi.fn(),
  // §11: every row carries an OwnerPicker now. It fetches nothing until opened, but a partial mock
  // of this module makes the whole list throw rather than the picker misbehave.
  listAssignableOwners: vi.fn().mockResolvedValue({ owners: [] }),
  transferPacingOwner: vi.fn(),
  listPacingOverview: vi.fn(),
  // §13: every row's "NetSuite diff" action fetches the live report through this module.
  getPacingNsDiff: vi.fn(),
}));

// §8: the Create Pacing panel's own behavior is covered by create-pacing-panel.test.tsx - here we
// only assert this tab swaps into it (gated on scope.can_create) and back, so its api module is
// mocked out rather than hit for real.
vi.mock("../../pacing-create/api", () => ({
  getPacingDraft: vi.fn(),
  createPacing: vi.fn(),
}));

// Who is asking decides whether the row carries an actions menu at all (delete is admin-only), so
// the tab reads the ["auth", "me"] cache - mocked here rather than left to hit the real client.
vi.mock("../../rbac/api", () => ({
  getCurrentUser: vi.fn(),
}));

// The delete itself is the Pacing admin screen's own passthrough, covered by its tests - here we
// only assert this tab reaches it with the right pacing id.
vi.mock("../../pacing-admin/api", () => ({
  deletePacing: vi.fn(),
  refreshAllDashboards: vi.fn(),
  revalidatePacing: vi.fn(),
}));

// §6: the dashboard itself is exercised by pacing-dashboard.test.tsx - here we only assert the tab
// swaps into it and back, so its own api module is mocked out rather than hit for real.
vi.mock("../../pacing-dashboard/api", () => ({
  getPacingDashboard: vi.fn(),
  getPacingRefreshStatus: vi.fn(),
  triggerPacingRefresh: vi.fn(),
  savePacingDisplay: vi.fn(),
  listPacingLibrary: vi.fn(),
  createPacingLibraryEntry: vi.fn(),
  updatePacingLibraryEntry: vi.fn(),
  deletePacingLibraryEntry: vi.fn(),
  setPacingLibraryLike: vi.fn(),
}));

function aCampaign(overrides: Partial<CampaignV1> = {}): CampaignV1 {
  return {
    id: 42,
    name: "Ourisman Ford 2026",
    status: "Live",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    budget: 1000000,
    channels: ["Display"],
    industry_vertical: "Automotive",
    ...overrides,
  };
}

function aPacing(overrides: Partial<PacingRowV1> = {}): PacingRowV1 {
  return {
    id: "p1",
    name: "Ourisman Ford Q1",
    status: "Live",
    lineItemCount: 3,
    alerts: [],
    ownerName: "Azat Nabiev",
    campaigns: [{ id: "42", name: "Ourisman Ford 2026" }],
    marginActualPct: 20,
    marginTargetPct: 25,
    pacingDeviationPct: -3.2,
    budgetTotal: 50000,
    paceStatus: "under",
    flightStart: "2026-01-01",
    flightEnd: "2026-03-31",
    ...overrides,
  };
}

function aResponse(pacings: PacingRowV1[], canCreate = true): PacingListResponseV1 {
  // Field is `can_create` on the wire (PacingScopeV1) - a prior version of this helper wrote
  // `canCreate` here, which TypeScript never caught because `src/test/**` is excluded from the
  // project's tsc build, so the mocked scope silently carried no `can_create` at all.
  return { scope: { kind: "all", ids: [], can_create: canCreate }, pacings };
}

/**
 * Renders the Pacing tab for campaign 42 by default, plus a stub `/campaigns/:id/pacing` route for
 * whatever OTHER campaign an "also covers" link points at, so following one doesn't just 404 in the
 * test — it renders the same tab again with that campaign's id, exactly like the real app.
 */
function renderTab(options: { initialPath?: string; initialState?: unknown; campaign?: CampaignV1 } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { initialPath = "/campaigns/42/pacing", initialState, campaign = aCampaign() } = options;
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[{ pathname: initialPath, state: initialState }]}>
          <Routes>
            <Route path="/campaigns/:campaignId" element={<CampaignRouteStub campaign={campaign} />}>
              <Route path="pacing" element={<PacingTab />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/**
 * Resolves the outlet context's campaign from the URL's :campaignId, the way the real
 * CampaignWorkspace does (fetched by id) — not always the one campaign `renderTab` was called with,
 * so that following an "also covers" link to a different campaign id actually renders a Pacing tab
 * scoped to THAT campaign, exactly as it would in the real app.
 */
function CampaignRouteStub({ campaign }: { campaign: CampaignV1 }) {
  const { campaignId } = useParams<{ campaignId: string }>();
  const numericId = campaignId ? Number(campaignId) : campaign.id;
  return (
    <Outlet
      context={
        { campaign: numericId === campaign.id ? campaign : { ...campaign, id: numericId } } satisfies CampaignTabContext
      }
    />
  );
}

// Row-head queries are anchored with `^`: each row now carries two buttons - its head and the actions
// trigger, whose accessible name is "Actions for <pacing name>" - so an unanchored /name/ matches both.
describe("PacingTab", () => {
  beforeEach(() => {
    vi.mocked(listCampaignPacings).mockReset();
    // Default caller: signed in, no ADMIN role - the majority of these tests are not about deletion.
    vi.mocked(getCurrentUser).mockReset().mockResolvedValue(aUserV1({ roles: [] }));
    vi.mocked(deletePacing).mockReset().mockResolvedValue(undefined);
    vi.mocked(revalidatePacing).mockReset().mockResolvedValue({ changed: false, changes: [], warnings: [] });
    vi.mocked(pacingDashboardApi.triggerPacingRefresh).mockReset().mockResolvedValue({ status: "started" });
    vi.mocked(getPacingNsDiff).mockReset().mockResolvedValue(aPacingNsDiffReportV1());
  });

  it("shows the empty state when the campaign has no pacings", async () => {
    // Given:
    vi.mocked(listCampaignPacings).mockResolvedValue(aResponse([]));

    // When:
    renderTab();

    // Then:
    expect(await screen.findByText("No pacings yet")).toBeInTheDocument();
  });

  // Regression: a response whose scope is absent used to throw inside render
  // ("Cannot read properties of undefined (reading 'can_create')"), and an uncaught
  // TypeError in render unmounts the tree - the tab went blank instead of showing
  // anything at all. The tab must degrade to "cannot create" rather than disappear.
  it("renders without a scope in the response instead of blanking the tab", async () => {
    // Given: a 200 whose body carries pacings but no scope
    vi.mocked(listCampaignPacings).mockResolvedValue({
      pacings: [],
    } as unknown as Awaited<ReturnType<typeof listCampaignPacings>>);

    // When:
    renderTab();

    // Then: the empty state renders, and the Create action is simply absent
    expect(await screen.findByText("No pacings yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Pacing" })).not.toBeInTheDocument();
  });

  it("lists every pacing whose campaign set contains this campaign (US-112)", async () => {
    // Given:
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([aPacing({ id: "p1", name: "Ourisman Ford Q1" }), aPacing({ id: "p2", name: "Ourisman Ford Q2" })])
    );

    // When:
    renderTab();

    // Then: both pacings for this campaign are listed
    expect(await screen.findByText("Ourisman Ford Q1")).toBeInTheDocument();
    expect(screen.getByText("Ourisman Ford Q2")).toBeInTheDocument();
    expect(listCampaignPacings).toHaveBeenCalledWith(42);
  });

  it("expands a pacing's detail in place when its row is opened, and collapses it again", async () => {
    // Given:
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([aPacing({ id: "p1", name: "Ourisman Ford Q1", lineItemCount: 7 })])
    );
    renderTab();
    const row = await screen.findByRole("button", { name: /^Ourisman Ford Q1/ });

    // When: opened
    await userEvent.click(row);

    // Then: detail renders in place, no navigation away from the tab
    expect(screen.getByText("Line items")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-expanded", "true");

    // When: closed again
    await userEvent.click(row);

    // Then:
    expect(screen.queryByText("Line items")).not.toBeInTheDocument();
    expect(row).toHaveAttribute("aria-expanded", "false");
  });

  it("names the other campaigns a multi-campaign pacing covers, and links to them (US-113)", async () => {
    // Given: this pacing also covers campaign 99, "Ourisman Toyota 2026"
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([
        aPacing({
          id: "p1",
          name: "Shared pacing",
          campaigns: [
            { id: "42", name: "Ourisman Ford 2026" },
            { id: "99", name: "Ourisman Toyota 2026" },
          ],
        }),
      ])
    );
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: /^Shared pacing/ }));

    // Then: the notice names the OTHER campaign only, not this one
    expect(screen.getByText(/This pacing also covers/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Ourisman Toyota 2026" });
    expect(link).toHaveAttribute("href", "/campaigns/99/pacing");
    expect(screen.queryByRole("link", { name: "Ourisman Ford 2026" })).not.toBeInTheDocument();
  });

  it("opens the same pacing on the other campaign's tab when its link is followed", async () => {
    // Given: campaign 42's Shared pacing also covers campaign 99, which has its own pacing too
    vi.mocked(listCampaignPacings).mockImplementation(async (campaignId: number) =>
      campaignId === 42
        ? aResponse([
            aPacing({
              id: "shared",
              name: "Shared pacing",
              campaigns: [
                { id: "42", name: "Ourisman Ford 2026" },
                { id: "99", name: "Ourisman Toyota 2026" },
              ],
            }),
          ])
        : aResponse([
            aPacing({ id: "shared", name: "Shared pacing" }),
            aPacing({ id: "toyota-only", name: "Toyota-only pacing" }),
          ])
    );
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: /^Shared pacing/ }));

    // When: following the "also covers" link to campaign 99
    await userEvent.click(screen.getByRole("link", { name: "Ourisman Toyota 2026" }));

    // Then: campaign 99's own Pacing tab renders, with the SAME pacing already expanded
    expect(await screen.findByText("Toyota-only pacing")).toBeInTheDocument();
    const reopened = screen.getByRole("button", { name: /^Shared pacing/ });
    expect(reopened).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the full dashboard from an expanded row, and returns to the list on Back (§6)", async () => {
    // Given: a row that has resolved a dash_slug (the dashboard needs it to call Pacing)
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([aPacing({ id: "p1", name: "Ourisman Ford Q1", dashSlug: "ourisman-ford-q1" })])
    );
    vi.mocked(pacingDashboardApi.getPacingDashboard).mockResolvedValue({
      campaign: { slug: "ourisman-ford-q1", pacingId: "p1", name: "Ourisman Ford Q1" },
      planByLineItem: {},
      factsDaily: [],
      asOf: null,
      display: { widgets: [] },
      aggregate: {},
      journal: [],
    });
    vi.mocked(pacingDashboardApi.getPacingRefreshStatus).mockResolvedValue({
      exists: false, refreshId: null, rowCount: 0, latestDate: null,
    });
    vi.mocked(pacingDashboardApi.listPacingLibrary).mockResolvedValue([]);
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: /^Ourisman Ford Q1/ }));

    // When: opening the full dashboard
    await userEvent.click(await screen.findByRole("button", { name: /open full dashboard/i }));

    // Then: the tab's own list is replaced by the dashboard, in place (no route change)
    expect(await screen.findByText(/back to pacings/i)).toBeInTheDocument();
    expect(screen.queryByText("Ourisman Ford 2026")).not.toBeInTheDocument();

    // When: going back
    await userEvent.click(screen.getByText(/back to pacings/i));

    // Then: the list (with the row still expanded) is showing again
    expect(await screen.findByText("Line items")).toBeInTheDocument();
  });

  it("expands and scrolls to the pacing named by router state on arrival (US-113, from the Overview)", async () => {
    // Given: the Overview navigated here after opening "Wanted pacing" specifically
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([aPacing({ id: "other", name: "Other pacing" }), aPacing({ id: "wanted", name: "Wanted pacing" })])
    );

    // When:
    renderTab({ initialState: { openPacingId: "wanted" } });

    // Then: the named pacing is expanded without any click
    const wantedRow = await screen.findByRole("button", { name: /^Wanted pacing/ });
    expect(wantedRow).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Other pacing/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the Create Pacing button when the caller may create, hides it otherwise (§8)", async () => {
    // Given:
    vi.mocked(listCampaignPacings).mockResolvedValue(aResponse([], false));

    // When:
    renderTab();
    await screen.findByText("No pacings yet");

    // Then: no create permission -> no button, and the empty state does not suggest one either
    expect(screen.queryByRole("button", { name: "Create Pacing" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Use.*Create Pacing/)).not.toBeInTheDocument();
  });

  it("swaps the list for the Create Pacing panel when clicked, and Back returns to the list (§8, US-121)", async () => {
    // Given:
    vi.mocked(listCampaignPacings).mockResolvedValue(aResponse([aPacing({ id: "p1", name: "Existing pacing" })]));
    vi.mocked(pacingCreateApi.getPacingDraft).mockResolvedValue({ ok: true, lineItems: [] });
    renderTab();
    await screen.findByText("Existing pacing");

    // When: opened
    await userEvent.click(screen.getByRole("button", { name: "Create Pacing" }));

    // Then: the campaign context is already known - no search step - and the list is replaced in place
    expect(await screen.findByRole("heading", { name: "Create Pacing" })).toBeInTheDocument();
    expect(pacingCreateApi.getPacingDraft).toHaveBeenCalledWith(42);
    expect(screen.queryByText("Existing pacing")).not.toBeInTheDocument();

    // When: going back
    await userEvent.click(screen.getByRole("button", { name: /Back to pacings/ }));

    // Then: the list shows again
    expect(await screen.findByText("Existing pacing")).toBeInTheDocument();
  });

  it("opens a just-created pacing's dashboard waiting for its first build, and an older empty one without (§8)", async () => {
    // Given: creating a pacing starts its first build fire-and-forget, so right after create the new
    // pacing has no data yet - and neither does an older one that has simply never built
    const emptyStatus = { exists: false, refreshId: undefined, rowCount: 0, latestDate: undefined };
    vi.mocked(listCampaignPacings)
      .mockResolvedValueOnce(aResponse([aPacing({ id: "old", name: "Older empty pacing", dashSlug: "older-empty" })]))
      .mockResolvedValue(
        aResponse([
          aPacing({ id: "old", name: "Older empty pacing", dashSlug: "older-empty" }),
          aPacing({ id: "new-p1", name: "Fresh pacing", dashSlug: "fresh-pacing" }),
        ])
      );
    vi.mocked(pacingCreateApi.getPacingDraft).mockResolvedValue(
      aPacingDraftV1({ campaign: "Fresh pacing", lineItems: [aPacingDraftLineItemV1({ lineItemId: "1" })] })
    );
    vi.mocked(pacingCreateApi.createPacing).mockResolvedValue(aPacingCreateResultV1({ pacingId: "new-p1" }));
    vi.mocked(pacingDashboardApi.getPacingDashboard).mockResolvedValue({
      campaign: { slug: "fresh-pacing", pacingId: "new-p1", name: "Fresh pacing" },
      planByLineItem: {},
      factsDaily: [],
      asOf: null,
      display: { widgets: [] },
      aggregate: {},
      journal: [],
    });
    vi.mocked(pacingDashboardApi.getPacingRefreshStatus).mockResolvedValue(emptyStatus);
    vi.mocked(pacingDashboardApi.listPacingLibrary).mockResolvedValue([]);
    renderTab();
    await screen.findByText("Older empty pacing");

    // When: creating a pacing, then opening its dashboard from the list it returns to
    await userEvent.click(screen.getByRole("button", { name: "Create Pacing" }));
    await screen.findByText("1");
    await userEvent.click(screen.getByRole("button", { name: "Create Pacing" }));
    await userEvent.click(await screen.findByRole("button", { name: /open full dashboard/i }));

    // Then: it waits for that first build rather than reading as a pacing with nothing coming
    expect(await screen.findByText(/pulling delivery data/i)).toBeInTheDocument();

    // When: going back and opening the older empty pacing instead
    await userEvent.click(screen.getByText(/back to pacings/i));
    await userEvent.click(await screen.findByRole("button", { name: /^Older empty pacing/ }));
    await userEvent.click(await screen.findByRole("button", { name: /open full dashboard/i }));

    // Then: no claim that anything is being pulled for it
    expect(await screen.findByText("No data has been built for this pacing yet.")).toBeInTheDocument();
    expect(screen.queryByText(/pulling delivery data/i)).not.toBeInTheDocument();
  });
  it("offers a non-admin the refresh action but neither revalidate nor delete", async () => {
    // Given: a signed-in caller without the ADMIN role
    vi.mocked(listCampaignPacings).mockResolvedValue(aResponse([aPacing({ name: "Ourisman Ford Q1" })]));

    // When:
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));

    // Then: refreshing a pacing you can see is not privileged; the two admin-only actions are absent
    // rather than shown and refused with a 403
    expect(await screen.findByRole("menuitem", { name: "Refresh data" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Revalidate from NS" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
    // §13, US-136: like Refresh, this writes nothing back, so it is not admin-gated either.
    expect(screen.getByRole("menuitem", { name: "NetSuite diff" })).toBeInTheDocument();
  });

  // §13, US-136. The live full breakdown, opened from the row menu, fetched fresh on every open.
  describe("NetSuite diff sheet", () => {
    it("opens the live report for a non-admin, with no differences shown as one message", async () => {
      vi.mocked(listCampaignPacings).mockResolvedValue(
        aResponse([aPacing({ id: "p1", name: "Ourisman Ford Q1" })])
      );
      vi.mocked(getPacingNsDiff).mockResolvedValue(aPacingNsDiffReportV1({ inSync: true }));
      renderTab();

      await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "NetSuite diff" }));

      expect(getPacingNsDiff).toHaveBeenCalledWith("p1");
      expect(await screen.findByText(/No differences — this pacing matches NetSuite/)).toBeInTheDocument();
    });

    it("shows each non-empty class with its own heading and count, live rather than the nightly summary", async () => {
      vi.mocked(listCampaignPacings).mockResolvedValue(
        aResponse([aPacing({ id: "p1", name: "Ourisman Ford Q1" })])
      );
      vi.mocked(getPacingNsDiff).mockResolvedValue(
        aPacingNsDiffReportV1({
          inSync: false,
          missingInPacing: [
            {
              lineItemId: "600433",
              campaignName: "Southwest",
              channel: "Native Display",
            },
          ],
          ownerDiff: [{ campaignId: "c1", campaignName: "Southwest", ownerName: "Azat Nabiev", mpoTeamLead: "Daria Feofanova" }],
        })
      );
      renderTab();

      await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "NetSuite diff" }));

      expect(await screen.findByText("Missing from this pacing")).toBeInTheDocument();
      // Grouped by flight and collapsed by default (§13 follow-up) - expand the one group to see it.
      await userEvent.click(screen.getByRole("button", { name: "No flight dates · 1" }));
      expect(screen.getByText("600433")).toBeInTheDocument();
      expect(screen.getByText("Owner differs from NetSuite")).toBeInTheDocument();
      expect(screen.getByText(/Pacing: Azat Nabiev · NetSuite: Daria Feofanova/)).toBeInTheDocument();
      // Only the two populated classes get a heading - no empty sections for the other four.
      expect(screen.queryByText("No longer in NetSuite")).not.toBeInTheDocument();
      expect(screen.queryByText("Field differences")).not.toBeInTheDocument();
    });

    it("surfaces a failed live check as an error, not a silent empty sheet", async () => {
      vi.mocked(listCampaignPacings).mockResolvedValue(
        aResponse([aPacing({ id: "p1", name: "Ourisman Ford Q1" })])
      );
      vi.mocked(getPacingNsDiff).mockRejectedValue(new Error("Pacing is unreachable"));
      renderTab();

      await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "NetSuite diff" }));

      expect(await screen.findByText("Pacing is unreachable")).toBeInTheDocument();
    });
  });

  it("triggers a refresh from the row menu and counts the cooldown down on the item", async () => {
    // Given:
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([aPacing({ id: "p1", name: "Ourisman Ford Q1", status: "Live" })])
    );
    renderTab();

    // When:
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Refresh data" }));

    // Then: the build is queued upstream and the toast says queued, not finished
    expect(pacingDashboardApi.triggerPacingRefresh).toHaveBeenCalledWith("p1");
    expect(await screen.findByText(/Refresh started for "Ourisman Ford Q1"/)).toBeInTheDocument();

    // And: re-opening the menu shows the two-minute window running, with the item off
    await userEvent.click(screen.getByRole("button", { name: "Actions for Ourisman Ford Q1" }));
    const item = await screen.findByRole("menuitem", { name: "Refresh data (120s)" });
    expect(item).toBeDisabled();
  });

  it("turns Pacing's cooldown refusal into that row's countdown instead of a bare error", async () => {
    // Given: a pacing someone else refreshed 75 seconds ago
    vi.mocked(listCampaignPacings).mockResolvedValue(aResponse([aPacing({ name: "Ourisman Ford Q1" })]));
    vi.mocked(pacingDashboardApi.triggerPacingRefresh).mockResolvedValue({
      status: "cooldown",
      retryAfterSeconds: 45,
    });
    renderTab();

    // When:
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Refresh data" }));

    // Then: the remaining seconds are what the row now shows - not "429", and not a fresh 120
    await userEvent.click(screen.getByRole("button", { name: "Actions for Ourisman Ford Q1" }));
    expect(await screen.findByRole("menuitem", { name: "Refresh data (45s)" })).toBeDisabled();
  });

  it("offers refresh disabled, with the reason, for a pacing that is not Live", async () => {
    // Given: Pacing answers 400 pacing_not_live for anything else, so the item must not be clickable
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([aPacing({ name: "Ourisman Ford Q1", status: "Paused" })])
    );
    renderTab();

    // When:
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));

    // Then:
    expect(await screen.findByRole("menuitem", { name: "Refresh data" })).toBeDisabled();
    expect(screen.getByText("Only a Live pacing can be refreshed.")).toBeInTheDocument();
    expect(pacingDashboardApi.triggerPacingRefresh).not.toHaveBeenCalled();
  });

  it("lets an admin re-validate a pacing from NetSuite, and says so when nothing changed", async () => {
    // Given: an admin, and a pacing already in step with the NetSuite master
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1({ roles: ["ADMIN"] }));
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([aPacing({ id: "p1", name: "Ourisman Ford Q1" })])
    );
    renderTab();

    // When:
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Revalidate from NS" }));

    // Then: it confirms first - this rewrites config from NetSuite, it is not a read
    expect(await screen.findByText('Re-validate "Ourisman Ford Q1"?')).toBeInTheDocument();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Re-validate" }));

    // Then: "already in sync" is reported as an outcome, not as silence
    expect(revalidatePacing).toHaveBeenCalledWith("p1");
    expect(await screen.findByText(/already matches NetSuite/)).toBeInTheDocument();
  });

  it("reports how many fields a re-validate updated", async () => {
    // Given:
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1({ roles: ["ADMIN"] }));
    vi.mocked(revalidatePacing).mockResolvedValue({
      changed: true,
      changes: ["client", "12345"],
      warnings: [],
    });
    vi.mocked(listCampaignPacings).mockResolvedValue(aResponse([aPacing({ name: "Ourisman Ford Q1" })]));
    renderTab();

    // When:
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Revalidate from NS" }));
    await userEvent.click(await screen.findByRole("button", { name: "Re-validate" }));

    // Then:
    expect(await screen.findByText(/2 fields updated/)).toBeInTheDocument();
  });

  it("does not offer a re-validate for an archived pacing", async () => {
    // Given: an admin, and a pacing there is nothing left to re-seed on
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1({ roles: ["ADMIN"] }));
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([aPacing({ name: "Ourisman Ford Q1", status: "Archive" })])
    );
    renderTab();

    // When:
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));

    // Then: delete is still there - only the re-validate is gone
    expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Revalidate from NS" })).not.toBeInTheDocument();
  });

  it("lets an admin delete a pacing from its row menu, once its name is typed", async () => {
    // Given: an admin
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1({ roles: ["ADMIN"] }));
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([aPacing({ id: "p1", name: "Ourisman Ford Q1", dashSlug: "ourisman_q1_ab12cd" })])
    );
    renderTab();

    // When: opening the row's menu and choosing Delete
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    // Then: the confirmation names the pacing and keeps the danger action off until it is typed back
    expect(await screen.findByText('Delete "Ourisman Ford Q1"?')).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();

    // When: typing the exact name and confirming
    await userEvent.type(screen.getByPlaceholderText("Ourisman Ford Q1"), "Ourisman Ford Q1");
    await userEvent.click(confirm);

    // Then: the delete goes out for THAT pacing and the confirmation closes
    expect(deletePacing).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(screen.queryByText('Delete "Ourisman Ford Q1"?')).not.toBeInTheDocument());
  });

  // The row lives on a campaign tab, but the pacing does not belong to that campaign - it can cover
  // several, and this delete removes it from all of them. Without this line the tab is the one place
  // in the product where a global delete looks local.
  it("warns, before deleting, that the pacing also covers other campaigns", async () => {
    // Given: an admin, and a pacing covering this campaign and one more
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1({ roles: ["ADMIN"] }));
    vi.mocked(listCampaignPacings).mockResolvedValue(
      aResponse([
        aPacing({
          name: "Ourisman Ford Q1",
          campaigns: [
            { id: "42", name: "Ourisman Ford 2026" },
            { id: "77", name: "Ourisman Ford Summer" },
          ],
        }),
      ])
    );
    renderTab();

    // When:
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    // Then: the other campaign is named, not merely counted
    expect(await screen.findByText(/Ourisman Ford Summer — deleting it removes it there too/)).toBeInTheDocument();
  });

  it("closes the row menu on an outside click without opening the row", async () => {
    // Given: an admin with the menu open
    vi.mocked(getCurrentUser).mockResolvedValue(aUserV1({ roles: ["ADMIN"] }));
    vi.mocked(listCampaignPacings).mockResolvedValue(aResponse([aPacing({ name: "Ourisman Ford Q1" })]));
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Ourisman Ford Q1" }));
    expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeInTheDocument();

    // When: clicking away
    await userEvent.click(document.body);

    // Then: the menu is gone, and the row underneath never toggled open (the trigger is a sibling of
    // the row head, not part of it)
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument());
    expect(screen.queryByText("Line items")).not.toBeInTheDocument();
  });
});
