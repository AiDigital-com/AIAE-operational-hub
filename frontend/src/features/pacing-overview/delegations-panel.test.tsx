import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./delegations-api";
import * as overviewApi from "./api";
import { DelegationsPanel } from "./delegations-panel";
import type { PacingDelegationV1 } from "./delegations-api";

/**
 * Delegations (§12, US-133/134/135).
 *
 * Every RULE belongs to Pacing - at most 30 days, no delegating to yourself, no duplicate live
 * grants are database constraints there. So these cases are about what this screen owes: that a
 * refusal is said in words a person can act on, that the date field cannot produce the commonest
 * refusal at all, and that a grant somebody gave ME is never offered a Revoke button.
 */

vi.mock("./delegations-api", () => ({
  listDelegations: vi.fn(),
  createDelegation: vi.fn(),
  extendDelegation: vi.fn(),
  revokeDelegation: vi.fn(),
}));
vi.mock("./api", () => ({
  listAssignableOwners: vi.fn(),
  listPacingOverview: vi.fn(),
  listCampaignPacings: vi.fn(),
  transferPacingOwner: vi.fn(),
  getPacingNsDiff: vi.fn(),
}));

function aDelegation(over: Partial<PacingDelegationV1> = {}): PacingDelegationV1 {
  return {
    delegationId: "d1",
    delegatorId: "u-me",
    delegatorName: "Me",
    delegateId: "u-them",
    delegateName: "Dasha",
    startsAt: "2026-09-01T00:00:00",
    expiresAt: "2026-09-20T23:59:59",
    direction: "granted",
    ...over,
  } as PacingDelegationV1;
}

function renderPanel(rows: PacingDelegationV1[], onClose: () => void = vi.fn()) {
  vi.mocked(api.listDelegations).mockResolvedValue(rows);
  vi.mocked(overviewApi.listAssignableOwners).mockResolvedValue({
    owners: [{ pacingUserId: "u-them", name: "Dasha", email: "dasha@aidigital.com" }],
  } as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DelegationsPanel open onClose={onClose} />
    </QueryClientProvider>
  );
}

describe("DelegationsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createDelegation).mockResolvedValue(undefined);
    vi.mocked(api.revokeDelegation).mockResolvedValue(undefined);
  });

  it("should bound the end date at 30 days so the commonest refusal never happens", async () => {
    // Given: the panel opens with today as the start
    renderPanel([]);
    await screen.findByLabelText("Until");

    // Then: the field itself cannot express a longer period. Pacing would refuse it, but a control
    // that makes the refusal unreachable is better than a message explaining one.
    const from = (screen.getByLabelText("From") as HTMLInputElement).value;
    const until = screen.getByLabelText("Until") as HTMLInputElement;
    const span = (new Date(`${until.max}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000;
    // 29, not 30: the start day counts toward the period.
    expect(span).toBe(29);
    expect(until.min).toBe(from);
  });

  it("should say what a refused grant broke, in words", async () => {
    // Given: Pacing refusing with its own code
    vi.mocked(api.createDelegation).mockRejectedValue(new Error("cannot_delegate_to_self"));
    renderPanel([]);
    await screen.findByRole("button", { name: "Delegate to" });

    // When: the same searchable picker the reassignment flow uses - the roster is the whole
    // organisation, so the person is found rather than scrolled to.
    await userEvent.click(screen.getByRole("button", { name: "Delegate to" }));
    await userEvent.click(await screen.findByRole("option", { name: /Dasha/ }));
    await userEvent.type(screen.getByLabelText("Until"), "2026-09-20");
    await userEvent.click(screen.getByRole("button", { name: "Delegate" }));

    // Then: the sentence the retired screen used, not a bare code
    expect(await screen.findByText("Cannot delegate to yourself")).toBeInTheDocument();
  });

  it("should name whoever was chosen, so the form can be read back before it is sent", async () => {
    // Given: the picker closed, showing a placeholder
    renderPanel([]);
    await screen.findByRole("button", { name: "Delegate to" });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Delegate to" }));
    await userEvent.click(await screen.findByRole("option", { name: /Dasha/ }));

    // Then: the id went somewhere, but an id is not something a person can check. The trigger reads
    // back the name, and says so to a screen reader too.
    expect(await screen.findByRole("button", { name: "Delegate to: Dasha" })).toBeInTheDocument();
    expect(screen.queryByText("Select a person…")).not.toBeInTheDocument();
  });

  it("should let Escape dismiss the picker without throwing away the form behind it", async () => {
    // Given: the picker open over a half-filled form. Both it and the sheet listen for Escape on the
    // document, and the sheet registered first - so without the picker taking the key first, one
    // press closed the whole drawer.
    const onClose = vi.fn();
    renderPanel([], onClose);
    await screen.findByRole("button", { name: "Delegate to" });
    await userEvent.type(screen.getByLabelText("Reason"), "Annual leave");
    await userEvent.click(screen.getByRole("button", { name: "Delegate to" }));
    await screen.findByRole("option", { name: /Dasha/ });

    // When:
    await userEvent.keyboard("{Escape}");

    // Then: the list is gone, the drawer and what was typed into it are not
    await waitFor(() => expect(screen.queryByRole("option", { name: /Dasha/ })).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Reason")).toHaveValue("Annual leave");
  });

  it("should not send a grant with nobody named", async () => {
    // Given:
    renderPanel([]);
    await screen.findByRole("button", { name: "Delegate to" });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Delegate" }));

    // Then: asked and answered here - a request that cannot succeed is not worth making
    expect(api.createDelegation).not.toHaveBeenCalled();
    expect(screen.getByText("Please select a user to delegate to")).toBeInTheDocument();
  });

  it("should offer Revoke on what I gave and not on what I was given", async () => {
    // Given: one of each. Pacing lets whoever owns the delegator's scope revoke either, but "cancel
    // the access somebody gave me" is a different act from "take back what I gave" - one button for
    // both is how a person revokes the wrong one.
    renderPanel([
      aDelegation({ delegationId: "mine", direction: "granted", delegateName: "Dasha" }),
      aDelegation({ delegationId: "theirs", direction: "received", delegatorName: "Lead" }),
    ]);

    // Then:
    await screen.findByText("Dasha");
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  });

  it("should say how much a portfolio-wide grant covers", async () => {
    // Given: a grant with no pacing named
    renderPanel([aDelegation({ pacingId: null, pacingCount: 14 })]);

    // Then: "everything I own" is not a quantity until it says how many
    expect(await screen.findByText("Everything they own (14)")).toBeInTheDocument();
  });

  it("should revoke the grant the row belongs to", async () => {
    // Given:
    renderPanel([aDelegation({ delegationId: "d-42" })]);
    await screen.findByText("Dasha");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));

    // Then:
    await waitFor(() => expect(api.revokeDelegation).toHaveBeenCalledWith("d-42"));
  });
});
