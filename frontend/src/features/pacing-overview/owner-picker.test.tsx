import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAssignableOwners, transferPacingOwner } from "./api";
import { OwnerPicker } from "./owner-picker";

vi.mock("./api", () => ({
  listAssignableOwners: vi.fn(),
  transferPacingOwner: vi.fn(),
  listPacingOverview: vi.fn(),
  listCampaignPacings: vi.fn(),
}));

function renderPicker(currentOwnerName: string | null = "Azat Nabiev") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OwnerPicker pacingId="p1" currentOwnerName={currentOwnerName} />
    </QueryClientProvider>
  );
}

/** Enough people that scrolling is not a strategy — the real roster is 655. */
const MANY = {
  owners: [
    { pacingUserId: "u-azat", name: "Azat Nabiev", email: "azat@aidigital.com" },
    { pacingUserId: "u-daria-f", name: "Daria Feofanova", email: "daria.f@aidigital.com" },
    { pacingUserId: "u-daria-k", name: "Daria Karpova", email: "daria.k@aidigital.com" },
    { pacingUserId: "u-bob", name: "Bob Petrov", email: "bob@aidigital.com" },
  ],
};

/** Renders the picker and opens it, returning the search box. */
async function open(user: ReturnType<typeof userEvent.setup>) {
  renderPicker();
  await user.click(screen.getByRole("button", { name: "Reassign" }));
  return screen.findByPlaceholderText(/Search by name or email/);
}

describe("OwnerPicker (§11, US-131)", () => {
  beforeEach(() => {
    vi.mocked(listAssignableOwners).mockReset().mockResolvedValue(MANY);
    vi.mocked(transferPacingOwner).mockReset().mockResolvedValue(undefined);
  });

  it("fetches nobody until it is opened", () => {
    // A list of two hundred rows must not fetch the roster for a user who is only reading.
    renderPicker();
    expect(listAssignableOwners).not.toHaveBeenCalled();
  });

  it("narrows the list by name as you type", async () => {
    const user = userEvent.setup();
    const search = await open(user);
    await user.type(search, "karpova");

    expect(await screen.findByText("Daria Karpova")).toBeInTheDocument();
    expect(screen.queryByText("Daria Feofanova")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob Petrov")).not.toBeInTheDocument();
  });

  it("narrows by email too, because fourteen people here are called Daria", async () => {
    const user = userEvent.setup();
    const search = await open(user);
    await user.type(search, "daria.f@");

    expect(await screen.findByText("Daria Feofanova")).toBeInTheDocument();
    expect(screen.queryByText("Daria Karpova")).not.toBeInTheDocument();
  });

  it("says so when nothing matches, rather than showing an empty box", async () => {
    const user = userEvent.setup();
    const search = await open(user);
    await user.type(search, "zzzz");

    expect(await screen.findByText(/Nobody matches/)).toBeInTheDocument();
  });

  it("reassigns to the person clicked", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.click(await screen.findByText("Daria Feofanova"));

    await waitFor(() => expect(transferPacingOwner).toHaveBeenCalledWith("p1", "u-daria-f"));
    // Closes on success — the row behind it re-reads and shows the new owner.
    await waitFor(() => expect(screen.getByRole("button", { name: "Reassign" })).toBeInTheDocument());
  });

  it("reassigns to the highlighted person on Enter, without reaching for the mouse", async () => {
    const user = userEvent.setup();
    const search = await open(user);
    await user.type(search, "daria");
    // Two Darias match; arrow down once to reach the second.
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(transferPacingOwner).toHaveBeenCalledWith("p1", "u-daria-k"));
  });

  it("moves the highlight back to the top when the search narrows", async () => {
    // A highlight left on row 3 of a list that now has one row would point at nothing — or worse, at
    // somebody the user never looked at, one Enter away from being handed the pacing.
    const user = userEvent.setup();
    const search = await open(user);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.type(search, "karpova");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(transferPacingOwner).toHaveBeenCalledWith("p1", "u-daria-k"));
  });

  it("stays open and shows why when Pacing refuses the transfer", async () => {
    // Pacing checks that the recipient is inside the caller's scope and answers 403 when not.
    // Closing on failure would leave the old owner on screen and read as success.
    const user = userEvent.setup();
    vi.mocked(transferPacingOwner).mockRejectedValue(new Error("new owner is outside your scope"));
    await open(user);
    await user.click(await screen.findByText("Daria Feofanova"));

    expect(await screen.findByText(/outside your scope/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search by name or email/)).toBeInTheDocument();
  });

  it("explains an empty roster rather than just saying nobody", async () => {
    // Empty means the §2 user sync has not reached anyone in this person's scope — a configuration
    // gap an admin fixes, not a permission answer.
    const user = userEvent.setup();
    vi.mocked(listAssignableOwners).mockResolvedValue({ owners: [] });
    await open(user);

    expect(await screen.findByText(/synced with Pacing yet/)).toBeInTheDocument();
  });

  // The bug this guards: a picker on the LAST row opened downwards, straight past the bottom of the
  // table, and could not be reached at all.
  describe("placement", () => {
    function openAt(triggerTop: number, viewportHeight: number) {
      window.innerHeight = viewportHeight;
      renderPicker();
      const trigger = screen.getByRole("button", { name: "Reassign" });
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
        top: triggerTop,
        bottom: triggerTop + 16,
        left: 120,
        right: 200,
        width: 80,
        height: 16,
        x: 120,
        y: triggerTop,
        toJSON: () => ({}),
      } as DOMRect);
      return trigger;
    }

    it("opens BELOW the trigger when there is room", async () => {
      const user = userEvent.setup();
      const trigger = openAt(100, 900);
      await user.click(trigger);

      const pop = document.querySelector(".opick") as HTMLElement;
      // 116 = the trigger's bottom, plus the 4px gap.
      expect(pop.style.top).toBe("120px");
    });

    it("flips ABOVE the trigger for a row near the bottom of the screen", async () => {
      const user = userEvent.setup();
      const trigger = openAt(700, 800);
      await user.click(trigger);

      const pop = document.querySelector(".opick") as HTMLElement;
      // Must sit above the trigger's own top (700), not below it and off-screen.
      expect(Number.parseInt(pop.style.top, 10)).toBeLessThan(700);
    });

    it("is rendered outside the table so nothing can clip it", async () => {
      const user = userEvent.setup();
      const trigger = openAt(100, 900);
      await user.click(trigger);

      // Portalled to <body>: positioned inside the row, the scrolling table would cut it off.
      expect(document.body.querySelector(":scope > .opick")).not.toBeNull();
    });
  });

  it("closes on Escape without reassigning anything", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByRole("button", { name: "Reassign" })).toBeInTheDocument());
    expect(transferPacingOwner).not.toHaveBeenCalled();
  });
});
