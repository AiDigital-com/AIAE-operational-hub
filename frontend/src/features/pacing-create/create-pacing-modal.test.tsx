import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingDraftLineItemV1, aPacingDraftV1 } from "@/test/factories";
import { ApiError } from "../../shared/api/api-error";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { createPacing, getPacingDraft, validatePacingLookup } from "./api";
import { CreatePacingModal } from "./create-pacing-modal";

vi.mock("./api", () => ({
  getPacingDraft: vi.fn(),
  createPacing: vi.fn(),
  validatePacingLookup: vi.fn(),
}));

function renderModal(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route path="/" element={<CreatePacingModal open onClose={onClose} />} />
              <Route path="/campaigns/:campaignId/pacing" element={<div data-testid="campaign-pacing" />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    ),
  };
}

describe("CreatePacingModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens as a centered dialog on step 1, no route or fetch of its own", () => {
    // When:
    renderModal();

    // Then: the Modal primitive's dialog, holding the step-1 lookup form.
    expect(screen.getByRole("dialog", { name: "Create Pacing" })).toBeInTheDocument();
    expect(screen.getByLabelText("Insertion order number")).toBeInTheDocument();
    expect(validatePacingLookup).not.toHaveBeenCalled();
  });

  it("reaches the review step from an insertion-order lookup (mode 1)", async () => {
    // Given:
    vi.mocked(validatePacingLookup).mockResolvedValue(
      aPacingDraftV1({ campaign: "2026_Campaign", lineItems: [aPacingDraftLineItemV1({ lineItemId: "599852" })] })
    );

    // When: typing an IO number and validating.
    renderModal();
    await userEvent.type(screen.getByLabelText(/Insertion order number/), "TM-271064");
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));

    // Then: the selector travelled trimmed as insertionOrderId, and step 2 shows the review panel
    // (the shared CreatePacingPanel) fed the returned draft - its name field pre-filled from the
    // campaign, no draft fetch of its own.
    expect(validatePacingLookup).toHaveBeenCalledWith({ insertionOrderId: "TM-271064" });
    await screen.findByText("599852");
    expect(screen.getByLabelText("Pacing name")).toHaveValue("2026_Campaign");
    expect(getPacingDraft).not.toHaveBeenCalled();
  });

  it("reaches the review step from a paste of line item ids (mode 2)", async () => {
    // Given:
    vi.mocked(validatePacingLookup).mockResolvedValue(
      aPacingDraftV1({ lineItems: [aPacingDraftLineItemV1({ lineItemId: "599852" })] })
    );

    // When: switching modes and pasting comma- and newline-separated ids.
    renderModal();
    await userEvent.click(screen.getByRole("button", { name: "Line item IDs" }));
    await userEvent.type(screen.getByLabelText(/Line item ids/), "599852, 599853\n599854");
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));

    // Then:
    expect(validatePacingLookup).toHaveBeenCalledWith({ lineItemIds: ["599852", "599853", "599854"] });
    await screen.findByText("599852");
  });

  it("stays on step 1 with the reason when the lookup answers ok:false", async () => {
    // Given: a mixed-currency lookup is a normal 200 with ok:false - walking into an empty step 2
    // instead is the bug the reference explicitly fixed.
    vi.mocked(validatePacingLookup).mockResolvedValue(
      aPacingDraftV1({ ok: false, error: "Mixed currencies: CAD, EUR", lineItems: [] })
    );

    // When:
    renderModal();
    await userEvent.type(screen.getByLabelText(/Insertion order number/), "TM-271064");
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));

    // Then: the reason on screen, still on step 1 (the mode switch is only rendered there).
    await screen.findByText("Mixed currencies: CAD, EUR");
    expect(screen.getByRole("button", { name: "Insertion order" })).toBeInTheDocument();
  });

  it("names what was looked up when the lookup finds nothing", async () => {
    // Given: NetSuite's own canonical spelling comes back on the response and wins over the typo.
    vi.mocked(validatePacingLookup).mockResolvedValue(
      aPacingDraftV1({ lineItems: [], orderNumber: "GIL - 13906" })
    );

    // When:
    renderModal();
    await userEvent.type(screen.getByLabelText(/Insertion order number/), "gil-13906");
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));

    // Then: never a silent empty table.
    await screen.findByText('No line items found for insertion order "GIL - 13906". Check the number in NetSuite.');
  });

  it("reads a 429 as 'wait a minute', not as a crash", async () => {
    // Given: Pacing allows 5 validates per user per minute.
    vi.mocked(validatePacingLookup).mockRejectedValue(new ApiError("You're doing that too quickly.", 429));

    // When:
    renderModal();
    await userEvent.type(screen.getByLabelText(/Insertion order number/), "TM-271064");
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));

    // Then:
    await screen.findByText("Pacing allows a few lookups per minute — wait a minute and try again.");
  });

  it("closes freely on step 1 - Esc and the header X hold no work to lose", async () => {
    // Given:
    const { onClose } = renderModal();
    await userEvent.type(screen.getByLabelText(/Insertion order number/), "TM-2");

    // When / Then: a typed lookup string is not a draft - Esc closes without a confirm.
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("guards a loaded draft behind an in-card confirm on every close path", async () => {
    // Given: a loaded draft - ticked rows and edited plan values may exist.
    vi.mocked(validatePacingLookup).mockResolvedValue(
      aPacingDraftV1({ lineItems: [aPacingDraftLineItemV1({ lineItemId: "599852" })] })
    );
    const { onClose } = renderModal();
    await userEvent.type(screen.getByLabelText(/Insertion order number/), "TM-271064");
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByText("599852");

    // When: a stray Esc.
    await userEvent.keyboard("{Escape}");

    // Then: NOT closed - the confirm asks first.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Discard this draft\?/)).toBeInTheDocument();

    // When: keeping the work.
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText(/Discard this draft\?/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // When: Esc again, and this time discarding.
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    // Then: now it closes.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("confirms 'Back to input' the same way, returning to step 1 without closing", async () => {
    // Given:
    vi.mocked(validatePacingLookup).mockResolvedValue(
      aPacingDraftV1({ lineItems: [aPacingDraftLineItemV1({ lineItemId: "599852" })] })
    );
    const { onClose } = renderModal();
    await userEvent.type(screen.getByLabelText(/Insertion order number/), "TM-271064");
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByText("599852");

    // When: going back to input, then confirming the discard.
    await userEvent.click(screen.getByRole("button", { name: "← Back to input" }));
    expect(screen.getByText(/Go back to input\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    // Then: step 1 again - the modal itself stayed open, and the typed lookup is still there.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Insertion order number")).toHaveValue("TM-271064");
  });

  it("closes and navigates to the new pacing's primary campaign after create", async () => {
    // Given: a draft whose line items derive campaign 310739.
    vi.mocked(validatePacingLookup).mockResolvedValue(
      aPacingDraftV1({ lineItems: [aPacingDraftLineItemV1({ lineItemId: "599855", campaignId: "310739" })] })
    );
    vi.mocked(createPacing).mockResolvedValue({ pacingId: "new-p1", dashSlug: "slug" });
    const { onClose } = renderModal();

    // When: validating, then creating from the review step.
    await userEvent.type(screen.getByLabelText(/Insertion order number/), "TM-271064");
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByText("599855");
    await userEvent.click(screen.getByRole("button", { name: "Create Pacing" }));

    // Then: the modal closed and the app landed on /campaigns/310739/pacing - the same route the
    // Overview opens a pacing through - with no discard confirm in the way.
    await screen.findByTestId("campaign-pacing");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
