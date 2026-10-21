import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

function renderPeople(list: CampaignShareListV1) {
  vi.mocked(api.listCampaignShares).mockResolvedValue(list);
  vi.mocked(api.listShareCandidates).mockResolvedValue([
    { hubUserId: 3, fullName: "Zlatan Peleksic", email: "zlatan@aidigital.com", roleName: "Team Lead", teamName: "Team Zlatan" },
  ]);
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

  it("lets someone who may share pick a person from the search", async () => {
    renderPeople({ canShare: true, shares: [] });

    await userEvent.click(await screen.findByRole("button", { name: "Add people" }));
    await userEvent.type(screen.getByLabelText("Add a person"), "zla");
    // The search is debounced: the fragment reaches the API a beat after the last keystroke.
    await waitFor(() => expect(api.listShareCandidates).toHaveBeenCalledWith(19813, "zla"));
    await userEvent.click(await screen.findByRole("button", { name: /Zlatan Peleksic/ }));

    await waitFor(() => expect(api.createCampaignShare).toHaveBeenCalledWith(19813, 3));
  });

  it("removes a person and says why when the backend refuses", async () => {
    renderPeople({ canShare: true, shares: [aShare()] });
    vi.mocked(api.deleteCampaignShare).mockRejectedValueOnce(new Error("User may not share campaign: 19813"));

    await userEvent.click(await screen.findByRole("button", { name: "Add people" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Beatris Felises" }));

    expect(await screen.findByText("User may not share campaign: 19813")).toBeInTheDocument();
    expect(api.deleteCampaignShare).toHaveBeenCalledWith(19813, 2);
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
