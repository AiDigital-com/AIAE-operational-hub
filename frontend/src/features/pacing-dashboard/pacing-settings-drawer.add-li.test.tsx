import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingDraftLineItemV1, aPacingLineItemPlanV1 } from "@/test/factories";
import * as planApi from "../pacing-plan/api";
import { PacingSettingsDrawer } from "./pacing-settings-drawer";
import type { AddLineItemRequest } from "./sheet-source-panel";

/**
 * «＋ Add line item…» from a mapping picker, through the drawer: the Add line item panel opens over
 * it, the chosen line items join the plan's draft, and the picker that asked gets the first id back -
 * the reference's openAddLiFromMapping / handleAddLiConfirm.
 *
 * The Mapping tab is stood in for by one picker: its moved editors call `onAddLineItem` exactly as
 * this stand-in does (the moved `LiSelect`), and what is under test is what the drawer does with it.
 */
vi.mock("./mapping-panel", () => ({
  PacingMappingSection: forwardRef(function MappingStandIn(
    { onAddLineItem }: { onAddLineItem?: AddLineItemRequest | null },
    _ref,
  ) {
    const [picked, setPicked] = useState("");
    return (
      <div>
        <button type="button" onClick={() => onAddLineItem?.((ids) => setPicked(ids[0] ?? ""))}>
          ＋ Add line item…
        </button>
        <output aria-label="Picked line item">{picked}</output>
      </div>
    );
  }),
}));
vi.mock("./spa/display/BlockLibrary.jsx", () => ({ default: () => null }));
vi.mock("./api", () => ({
  savePacingDataSettings: vi.fn(),
  savePacingCampaignLinks: vi.fn(),
  savePacingDisplay: vi.fn(),
  savePacingNotifySettings: vi.fn(),
  listPacingLibrary: vi.fn(),
  createPacingLibraryEntry: vi.fn(),
  updatePacingLibraryEntry: vi.fn(),
  deletePacingLibraryEntry: vi.fn(),
}));
vi.mock("../pacing-plan/api", () => ({
  savePacingPlan: vi.fn(),
  getAddablePacingLineItems: vi.fn(),
  validatePacingLineItemsById: vi.fn(),
  updatePacingStatus: vi.fn(),
}));

function renderDrawer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PacingSettingsDrawer
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        slug="nike-ss26"
        currency="USD"
        rate={1}
        planByLineItem={{ "111": aPacingLineItemPlanV1({ lineItemId: "111" }) }}
        data={{ source: "platform_mart" }}
        display={{ rev: 3, widgets: [], groups: [] }}
        capabilities={{ contextWidgetSpec: 2 }}
        isAdmin={false}
      />
    </QueryClientProvider>
  );
}

describe("PacingSettingsDrawer - Add line item from a mapping picker", () => {
  beforeEach(() => {
    vi.mocked(planApi.getAddablePacingLineItems).mockReset().mockResolvedValue({
      ok: true,
      io: "3854",
      addable: [aPacingDraftLineItemV1({ lineItemId: "772073", channel: "CTV", currency: "USD" })],
      alreadyAdded: ["111"],
    });
    vi.mocked(planApi.savePacingPlan).mockReset().mockResolvedValue({ saved: true });
  });

  it("opens the panel over the drawer and hands the first added line item back to the picker", async () => {
    // Given:
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole("button", { name: /^Mapping/ }));

    // When: the picker asks for a line item it does not have yet
    await user.click(screen.getByRole("button", { name: "＋ Add line item…" }));
    const dialog = await screen.findByRole("dialog", { name: "Add line item" });
    await user.click(await screen.findByRole("checkbox", { name: /LI 772073/ }));
    await user.click(screen.getByRole("button", { name: "Add selected (1)" }));

    // Then: the question is gone, the picker holds the new line item, and the plan's draft has it
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByLabelText("Picked line item")).toHaveTextContent("772073");
    await user.click(screen.getByRole("button", { name: /^Pacing/ }));
    expect(await screen.findByText("LI 772073")).toBeInTheDocument();
  });
});
