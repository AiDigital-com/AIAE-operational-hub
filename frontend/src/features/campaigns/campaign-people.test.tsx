import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./shares-api";
import { CampaignPeople, initials } from "./campaign-people";
import type { CampaignShareListV1, CampaignShareV1 } from "./shares-api";

/**
 * "Add people" on a campaign (2026-10-20).
 *
 * Who may share is the backend's answer (`canShare`); this screen owes three things: the people are
 * shown to everyone who sees the campaign, the controls to change them appear only when allowed, and
 * a pick or a Remove reaches the API with the right person.
 */

vi.mock("./shares-api", () => ({
  listCampaignShares: vi.fn(),
  listShareCandidates: vi.fn(),
  listShareOwnedPacings: vi.fn(),
  createCampaignShare: vi.fn(),
  deleteCampaignShare: vi.fn(),
}));

function aShare(over: Partial<CampaignShareV1> = {}): CampaignShareV1 {
  return {
    hubUserId: 2,
    fullName: "Beatris Felises",
    email: "beatris.felises@aidigital.com",
    roleName: "MPO Manager",
    teamName: "Team Vlad Chubakov",
    grantedByName: "Azat Nabiev",
    createdAt: "2026-10-20T15:47:54",
    ...over,
  };
}

function renderPeople(list: Omit<CampaignShareListV1, "teamAccess"> & Partial<Pick<CampaignShareListV1, "teamAccess">>) {
  vi.mocked(api.listCampaignShares).mockResolvedValue({ teamAccess: [], ...list });
  vi.mocked(api.listShareCandidates).mockResolvedValue([
    { hubUserId: 3, fullName: "Zlatan Peleksic", email: "zlatan@aidigital.com", roleName: "Team Lead", teamName: "Team Zlatan" },
  ]);
  vi.mocked(api.listShareOwnedPacings).mockResolvedValue([]);
  vi.mocked(api.createCampaignShare).mockResolvedValue();
  vi.mocked(api.deleteCampaignShare).mockResolvedValue();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CampaignPeople campaignId={19813} />
    </QueryClientProvider>
  );
}

describe("CampaignPeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows who is on the campaign to someone who may not share, without Add people", async () => {
    renderPeople({ canShare: false, shares: [aShare()] });

    expect(await screen.findByRole("button", { name: /1 person added/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add people" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /1 person added/ }));
    expect(screen.getByText("Beatris Felises")).toBeInTheDocument();
    expect(screen.getByText("MPO Manager · Team Vlad Chubakov")).toBeInTheDocument();
  });

  it("shows the full text in a bubble on hover, since the row cuts it short", async () => {
    renderPeople({ canShare: false, shares: [aShare()] });

    await userEvent.click(await screen.findByRole("button", { name: /1 person added/ }));
    await userEvent.hover(screen.getByText("MPO Manager · Team Vlad Chubakov"));

    const bubble = screen.getByRole("tooltip");
    expect(bubble).toHaveTextContent("Beatris Felises");
    expect(bubble).toHaveTextContent("MPO Manager · Team Vlad Chubakov");
    expect(bubble).toHaveTextContent("beatris.felises@aidigital.com");
    expect(bubble).toHaveTextContent("Added by Azat Nabiev");
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add a person")).not.toBeInTheDocument();
  });

  it("renders nothing when nobody is added and the viewer may not share", async () => {
    renderPeople({ canShare: false, shares: [] });

    await waitFor(() => expect(api.listCampaignShares).toHaveBeenCalledWith(19813));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists who sees the campaign through its team, with no way to remove them", async () => {
    renderPeople({
      canShare: true,
      shares: [aShare()],
      teamAccess: [
        { hubUserId: 6, fullName: "Galina Kozlova", email: "galina@aidigital.com", roleName: "Team Lead", teamName: "Team Galina" },
      ],
    });

    await userEvent.click(await screen.findByRole("button", { name: "Add people" }));
    // Folded until asked for, so a big team does not push the share list away.
    expect(screen.queryByRole("list", { name: "Team access" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Team access/ }));

    const team = screen.getByRole("list", { name: "Team access" });
    expect(within(team).getByText("Galina Kozlova")).toBeInTheDocument();
    expect(within(team).getByText("Team Lead · Team Galina")).toBeInTheDocument();
    expect(within(team).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Beatris Felises" })).toBeInTheDocument();
    expect(screen.getByText("Admins can see every campaign.")).toBeInTheDocument();
  });

  it("asks for no suggestions until something is typed", async () => {
    renderPeople({ canShare: true, shares: [aShare()] });

    await userEvent.click(await screen.findByRole("button", { name: "Add people" }));

    expect(screen.getByText("Added to Campaign")).toBeInTheDocument();
    expect(api.listShareCandidates).not.toHaveBeenCalled();
  });

  it("lets someone who may share pick a person from the search", async () => {
    renderPeople({ canShare: true, shares: [] });

    await userEvent.click(await screen.findByRole("button", { name: "Add people" }));
    await userEvent.type(screen.getByLabelText("Add a person"), "zla");
    // The search is debounced: the fragment reaches the API a beat after the last keystroke.
    await waitFor(() => expect(api.listShareCandidates).toHaveBeenCalledWith(19813, "zla"));
    await userEvent.click(await screen.findByRole("button", { name: /Zlatan Peleksic/ }));

    await waitFor(() => expect(api.createCampaignShare).toHaveBeenCalledWith(19813, 3));
  });

  it("removes a person who owns nothing here at once, and says why when the backend refuses", async () => {
    renderPeople({ canShare: true, shares: [aShare()] });
    vi.mocked(api.deleteCampaignShare).mockRejectedValueOnce(new Error("User may not share campaign: 19813"));

    await userEvent.click(await screen.findByRole("button", { name: "Add people" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Beatris Felises" }));

    expect(await screen.findByText("User may not share campaign: 19813")).toBeInTheDocument();
    expect(api.listShareOwnedPacings).toHaveBeenCalledWith(19813, 2);
    expect(api.deleteCampaignShare).toHaveBeenCalledWith(19813, 2, false);
    expect(screen.queryByRole("dialog", { name: /Remove Beatris Felises\?/ })).not.toBeInTheDocument();
  });

  it("asks before removing someone who owns pacings here, naming every campaign each one spans", async () => {
    renderPeople({ canShare: true, shares: [aShare()] });
    vi.mocked(api.listShareOwnedPacings).mockResolvedValue([
      {
        pacingId: "p1",
        dashSlug: "fox-2026",
        pacingName: "Fox 2026",
        campaigns: [{ id: "19813", name: "Fox Factory Ridetech" }, { id: "777", name: "Fox Summer" }],
      },
      { pacingId: "p2", dashSlug: "fox-q4", pacingName: "Fox Q4", campaigns: [{ id: "19813", name: null }] },
    ]);

    await userEvent.click(await screen.findByRole("button", { name: "Add people" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Beatris Felises" }));

    // Then: nothing deleted yet; the dialog lists both pacings, and the one spanning two campaigns says so
    const dialog = await screen.findByRole("dialog", { name: "Remove Beatris Felises?" });
    expect(dialog).toHaveTextContent("owns 2 pacings on this campaign");
    expect(dialog).toHaveTextContent("Fox 2026");
    expect(dialog).toHaveTextContent("Spans 2 campaigns: Fox Factory Ridetech, Fox Summer");
    expect(dialog).toHaveTextContent("Covers: Campaign 19813");
    expect(api.deleteCampaignShare).not.toHaveBeenCalled();

    // When: confirmed
    await userEvent.click(screen.getByRole("button", { name: "Transfer to me and remove" }));

    // Then: the delete carries the confirmation
    await waitFor(() => expect(api.deleteCampaignShare).toHaveBeenCalledWith(19813, 2, true));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove Beatris Felises?" })).not.toBeInTheDocument());
  });

  it("deletes nothing when the removal is cancelled", async () => {
    renderPeople({ canShare: true, shares: [aShare()] });
    vi.mocked(api.listShareOwnedPacings).mockResolvedValue([
      { pacingId: "p1", dashSlug: "fox-2026", pacingName: "Fox 2026", campaigns: [{ id: "19813", name: "Fox" }] },
    ]);

    await userEvent.click(await screen.findByRole("button", { name: "Add people" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Beatris Felises" }));
    await screen.findByRole("dialog", { name: "Remove Beatris Felises?" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove Beatris Felises?" })).not.toBeInTheDocument());
    expect(api.deleteCampaignShare).not.toHaveBeenCalled();
  });

  it("marks a person who is here because they own a pacing", async () => {
    renderPeople({ canShare: false, shares: [aShare({ source: "pacing_created", grantedByName: "Beatris Felises" })] });

    await userEvent.click(await screen.findByRole("button", { name: /1 person added/ }));

    expect(screen.getByText("via pacing")).toBeInTheDocument();
    await userEvent.hover(screen.getByText("MPO Manager · Team Vlad Chubakov"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Added automatically - owns a pacing on this campaign");
  });

  it("stacks at most four faces and counts the rest", async () => {
    const shares = [1, 2, 3, 4, 5, 6].map((n) => aShare({ hubUserId: n, fullName: `Person ${n}` }));
    renderPeople({ canShare: false, shares });

    const stack = await screen.findByRole("button", { name: /6 people added/ });
    expect(stack.textContent).toContain("+2");
  });
});

describe("roleLine", () => {
  it("joins role and team, and falls back to the email for someone without a role", async () => {
    const { roleLine } = await import("./campaign-people");
    expect(roleLine({ roleName: "Team Lead", teamName: "Team Zlatan" })).toBe("Team Lead · Team Zlatan");
    expect(roleLine({ roleName: "Director" })).toBe("Director");
    expect(roleLine({ email: "x@aidigital.com" })).toBe("x@aidigital.com");
  });
});

describe("initials", () => {
  it("takes the first letters of the first two words, or of the email", () => {
    expect(initials({ fullName: "Beatris Felises" })).toBe("BF");
    expect(initials({ fullName: "Cher" })).toBe("C");
    expect(initials({ fullName: "", email: "dan.tomkin@aidigital.com" })).toBe("DT");
    expect(initials({})).toBe("?");
  });
});
