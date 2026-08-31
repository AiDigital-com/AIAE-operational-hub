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
});
