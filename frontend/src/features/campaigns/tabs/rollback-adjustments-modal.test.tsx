import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewAdjustmentRollback, rollbackAdjustments } from "../api";
import type { DateWindow } from "../hooks";
import { RollbackAdjustmentsModal } from "./rollback-adjustments-modal";

vi.mock("../api", () => ({
  previewAdjustmentRollback: vi.fn(),
  rollbackAdjustments: vi.fn(),
}));

const SCOPE_NAMES = ["barr_SCOT_Fall Campaign_Display"];
const DATE_WINDOW: DateWindow = { from: "2026-01-01", to: "2026-01-31" };

function renderModal(
  overrides: {
    campaignConstructedNames?: string[];
    constructedNamesLvl2?: string[];
    constructedNamesLvl3?: string[];
    level2Label?: string;
    level3Label?: string;
    dateWindow?: DateWindow;
    onClose?: () => void;
    onRolledBack?: (result: { deliveryRowsRemoved: number; conversionRowsRemoved: number }) => void;
    queryClient?: QueryClient;
  } = {}
) {
  const queryClient = overrides.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = overrides.onClose ?? vi.fn();
  const onRolledBack = overrides.onRolledBack ?? vi.fn();
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <RollbackAdjustmentsModal
        open
        campaignId={42}
        campaignConstructedNames={overrides.campaignConstructedNames ?? SCOPE_NAMES}
        constructedNamesLvl2={overrides.constructedNamesLvl2 ?? []}
        constructedNamesLvl3={overrides.constructedNamesLvl3 ?? []}
        level2Label={overrides.level2Label ?? "Insertion order name"}
        level3Label={overrides.level3Label ?? "Creative name"}
        dateWindow={overrides.dateWindow ?? DATE_WINDOW}
        onClose={onClose}
        onRolledBack={onRolledBack}
      />
    </QueryClientProvider>
  );
  return { queryClient, onClose, onRolledBack, container };
}

/** The counts paragraph's own text - queried by class rather than by content, whose two `<strong>`
 * digits (3, 1) collide with substrings of the rendered date window ("...-31", "...-01") under a plain
 * text-content regex match. */
function countsText(container: HTMLElement): string {
  return container.querySelector(".rollback-adjustments-modal__counts")?.textContent ?? "";
}

describe("RollbackAdjustmentsModal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should show a hint and no preview call when no level-1 campaign is selected", () => {
    // Given: an empty scope selection
    renderModal({ campaignConstructedNames: [] });

    // Then:
    expect(screen.getByText(/filter the report by line item name/i)).toBeInTheDocument();
    expect(previewAdjustmentRollback).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /roll back adjustments/i })).toBeDisabled();
  });

  it("should state that the rollback covers every platform and dimension, not just the report's other active filters", () => {
    // Given: a complete scope, so the note is on screen (nothing about it depends on the preview answer)
    vi.mocked(previewAdjustmentRollback).mockReturnValue(new Promise(() => {}));

    // When:
    renderModal();

    // Then:
    expect(
      screen.getByText(/every platform and every other dimension/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/not just what the report's other filters are currently showing/i)).toBeInTheDocument();
  });

  it("should show a hint and no preview call when the date window is incomplete", () => {
    // Given: only one bound of the date window is set
    renderModal({ dateWindow: { from: "2026-01-01", to: "" } });

    // Then:
    expect(screen.getByText(/set both a start and end date/i)).toBeInTheDocument();
    expect(previewAdjustmentRollback).not.toHaveBeenCalled();
  });

  it("should show a loading state while the preview is pending", () => {
    // Given: a preview call that never resolves during this test
    vi.mocked(previewAdjustmentRollback).mockReturnValue(new Promise(() => {}));

    // When:
    renderModal();

    // Then:
    expect(screen.getByRole("status", { name: /calculating what would be removed/i })).toBeInTheDocument();
  });

  it("should render the scope and the preview counts once the preview resolves", async () => {
    // Given:
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({
      deliveryRowsRemoved: 3,
      conversionRowsRemoved: 1,
    });

    // When:
    const { container } = renderModal();

    // Then:
    expect(screen.getByText("barr_SCOT_Fall Campaign_Display")).toBeInTheDocument();
    expect(screen.getByText("2026-01-01 – 2026-01-31")).toBeInTheDocument();
    await waitFor(() => expect(countsText(container)).toContain("delivery adjustment row"));
    expect(countsText(container)).toContain("3");
    expect(countsText(container)).toContain("conversions adjustment row");
    expect(countsText(container)).toContain("1");
    expect(previewAdjustmentRollback).toHaveBeenCalledWith(42, {
      campaignConstructedNames: SCOPE_NAMES,
      constructedNamesLvl2: [],
      constructedNamesLvl3: [],
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
  });

  it("should render an accessible error state when the preview fails", async () => {
    // Given:
    vi.mocked(previewAdjustmentRollback).mockRejectedValue(new Error("boom"));

    // When:
    renderModal();

    // Then:
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
  });

  it("should disable the confirm button when nothing would be removed", async () => {
    // Given: a scope with no existing Hub adjustments
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({
      deliveryRowsRemoved: 0,
      conversionRowsRemoved: 0,
    });

    // When:
    renderModal();

    // Then:
    await screen.findByText(/nothing would change/i);
    expect(screen.getByRole("button", { name: /roll back adjustments/i })).toBeDisabled();
    expect(rollbackAdjustments).not.toHaveBeenCalled();
  });

  it("should not call the rollback API when Cancel is clicked", async () => {
    // Given:
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({
      deliveryRowsRemoved: 3,
      conversionRowsRemoved: 1,
    });
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await screen.findByText(/delivery adjustment row/i);

    // When:
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    // Then:
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(rollbackAdjustments).not.toHaveBeenCalled();
  });

  it("should call the rollback API and invoke onRolledBack when confirm is clicked", async () => {
    // Given:
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({
      deliveryRowsRemoved: 3,
      conversionRowsRemoved: 1,
    });
    vi.mocked(rollbackAdjustments).mockResolvedValue({
      deliveryRowsRemoved: 3,
      conversionRowsRemoved: 1,
    });
    const user = userEvent.setup();
    const { onRolledBack } = renderModal();
    await screen.findByText(/delivery adjustment row/i);

    // When:
    await user.click(screen.getByRole("button", { name: /roll back adjustments/i }));

    // Then:
    await waitFor(() =>
      expect(onRolledBack).toHaveBeenCalledWith({ deliveryRowsRemoved: 3, conversionRowsRemoved: 1 })
    );
    expect(rollbackAdjustments).toHaveBeenCalledWith(42, {
      campaignConstructedNames: SCOPE_NAMES,
      constructedNamesLvl2: [],
      constructedNamesLvl3: [],
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
  });

  it("should invalidate the report-rows queries after a successful rollback", async () => {
    // Given:
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({
      deliveryRowsRemoved: 3,
      conversionRowsRemoved: 1,
    });
    vi.mocked(rollbackAdjustments).mockResolvedValue({
      deliveryRowsRemoved: 3,
      conversionRowsRemoved: 1,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const user = userEvent.setup();
    renderModal({ queryClient });
    await screen.findByText(/delivery adjustment row/i);

    // When:
    await user.click(screen.getByRole("button", { name: /roll back adjustments/i }));

    // Then:
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["campaigns", "report-rows", 42] })
    );
  });

  it("should render an accessible error state when the rollback fails", async () => {
    // Given:
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({
      deliveryRowsRemoved: 3,
      conversionRowsRemoved: 1,
    });
    vi.mocked(rollbackAdjustments).mockRejectedValue(new Error("rollback failed"));
    const user = userEvent.setup();
    const { onRolledBack } = renderModal();
    await screen.findByText(/delivery adjustment row/i);

    // When:
    await user.click(screen.getByRole("button", { name: /roll back adjustments/i }));

    // Then:
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("rollback failed");
    expect(onRolledBack).not.toHaveBeenCalled();
  });

  it("should forward both optional levels to the preview and rollback calls when both are narrowed", async () => {
    // Given: both level-2 and level-3 narrowing are set
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({ deliveryRowsRemoved: 2, conversionRowsRemoved: 0 });
    vi.mocked(rollbackAdjustments).mockResolvedValue({ deliveryRowsRemoved: 2, conversionRowsRemoved: 0 });
    const user = userEvent.setup();
    renderModal({ constructedNamesLvl2: ["IO 1"], constructedNamesLvl3: ["Creative 1"] });
    await screen.findByText(/delivery adjustment row/i);

    // Then: the preview call carried both narrowing levels
    expect(previewAdjustmentRollback).toHaveBeenCalledWith(42, {
      campaignConstructedNames: SCOPE_NAMES,
      constructedNamesLvl2: ["IO 1"],
      constructedNamesLvl3: ["Creative 1"],
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });

    // When:
    await user.click(screen.getByRole("button", { name: /roll back adjustments/i }));

    // Then: the rollback call carried the same narrowing
    await waitFor(() =>
      expect(rollbackAdjustments).toHaveBeenCalledWith(42, {
        campaignConstructedNames: SCOPE_NAMES,
        constructedNamesLvl2: ["IO 1"],
        constructedNamesLvl3: ["Creative 1"],
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
      })
    );
  });

  it("should forward level 3 alone when level 2 is not narrowed, proving the two levels are independent", async () => {
    // Given: only level 3 is narrowed
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({ deliveryRowsRemoved: 1, conversionRowsRemoved: 0 });

    // When:
    renderModal({ constructedNamesLvl3: ["Creative 1"] });
    await screen.findByText(/delivery adjustment row/i);

    // Then:
    expect(previewAdjustmentRollback).toHaveBeenCalledWith(42, {
      campaignConstructedNames: SCOPE_NAMES,
      constructedNamesLvl2: [],
      constructedNamesLvl3: ["Creative 1"],
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
  });

  it("should show a scope row only for a level that is actually narrowed", async () => {
    // Given: only level 2 is narrowed
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({ deliveryRowsRemoved: 1, conversionRowsRemoved: 0 });

    // When:
    renderModal({ constructedNamesLvl2: ["IO 1"] });
    await screen.findByText(/delivery adjustment row/i);

    // Then:
    expect(screen.getByText("Insertion order name")).toBeInTheDocument();
    expect(screen.getByText("IO 1")).toBeInTheDocument();
    expect(screen.queryByText("Creative name")).not.toBeInTheDocument();
  });

  it("should not show either optional level's scope row when neither is narrowed", async () => {
    // Given/When: no optional narrowing at all
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({ deliveryRowsRemoved: 1, conversionRowsRemoved: 0 });
    renderModal();
    await screen.findByText(/delivery adjustment row/i);

    // Then:
    expect(screen.queryByText("Insertion order name")).not.toBeInTheDocument();
    expect(screen.queryByText("Creative name")).not.toBeInTheDocument();
  });

  it("should state the narrowed dimension in the warning once a level is narrowed", () => {
    // Given: level 2 is narrowed, so the warning must no longer claim "every other dimension"
    vi.mocked(previewAdjustmentRollback).mockReturnValue(new Promise(() => {}));

    // When:
    renderModal({ constructedNamesLvl2: ["IO 1"] });

    // Then:
    expect(
      screen.getByText(/every platform and every dimension other than insertion order name/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/every platform and every other dimension/i)).not.toBeInTheDocument();
  });

  it("should refetch the preview when the level-2 narrowing changes", async () => {
    // Given: the modal is open with no level-2 narrowing yet
    vi.mocked(previewAdjustmentRollback).mockResolvedValue({ deliveryRowsRemoved: 1, conversionRowsRemoved: 0 });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      open: true,
      campaignId: 42,
      campaignConstructedNames: SCOPE_NAMES,
      constructedNamesLvl3: [] as string[],
      level2Label: "Insertion order name",
      level3Label: "Creative name",
      dateWindow: DATE_WINDOW,
      onClose: vi.fn(),
      onRolledBack: vi.fn(),
    };
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RollbackAdjustmentsModal {...props} constructedNamesLvl2={[]} />
      </QueryClientProvider>
    );
    await screen.findByText(/delivery adjustment row/i);
    expect(previewAdjustmentRollback).toHaveBeenCalledTimes(1);

    // When: the level-2 narrowing changes
    rerender(
      <QueryClientProvider client={queryClient}>
        <RollbackAdjustmentsModal {...props} constructedNamesLvl2={["IO 1"]} />
      </QueryClientProvider>
    );

    // Then: a second preview call is issued for the narrowed scope, not served from the earlier cache entry
    await waitFor(() => expect(previewAdjustmentRollback).toHaveBeenCalledTimes(2));
    expect(previewAdjustmentRollback).toHaveBeenLastCalledWith(42, {
      campaignConstructedNames: SCOPE_NAMES,
      constructedNamesLvl2: ["IO 1"],
      constructedNamesLvl3: [],
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
  });
});
