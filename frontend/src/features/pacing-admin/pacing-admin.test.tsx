import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingListResponseV1, aPacingRowV1 } from "@/test/factories";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { listPacingOverview } from "../pacing-overview/api";
import * as adminApi from "./api";
import { PacingAdmin } from "./pacing-admin";

vi.mock("../pacing-overview/api", () => ({
  listPacingOverview: vi.fn(),
}));

vi.mock("./api", () => ({
  deletePacing: vi.fn(),
  refreshAllDashboards: vi.fn(),
  backfillOrderNumbers: vi.fn(),
}));

// StatusControl (pacing-plan) is reused as-is and has its own test coverage - stubbed here to keep
// this suite about the admin screen's own behaviour, not the status dropdown's.
vi.mock("../pacing-plan/api", () => ({
  updatePacingStatus: vi.fn(),
}));

function renderAdmin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* ToastProvider: the Sync IO numbers button reports its summary and its errors as toasts. */}
      <ToastProvider>
        <PacingAdmin />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("PacingAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders name, slug, owner, status, flight and created for every pacing", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({
            id: "p1",
            name: "Nike SS26 Display",
            dashSlug: "nike-ss26-display",
            ownerName: "Azat Nabiev",
            status: "Live",
            flightStart: "2026-08-01",
            flightEnd: "2026-09-30",
            createdAt: "2026-07-15T09:30:00",
          }),
        ],
      })
    );

    // When:
    renderAdmin();
    const row = await screen.findByRole("row", { name: /nike ss26 display/i });

    // Then:
    expect(within(row).getByText("nike-ss26-display")).toBeInTheDocument();
    expect(within(row).getByText("Azat Nabiev")).toBeInTheDocument();
    expect(within(row).getByLabelText("Change pacing status")).toHaveValue("Live");
    expect(within(row).getByText(/aug 1, 2026/i)).toBeInTheDocument();
    expect(within(row).getByText(/jul 15, 2026/i)).toBeInTheDocument();
  });

  it("puts the search box first, before refresh-all, and filters by name or slug", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ id: "p1", name: "Nike SS26", dashSlug: "nike-ss26" }),
          aPacingRowV1({ id: "p2", name: "Service Experts Q1", dashSlug: "service-experts-q1" }),
        ],
      })
    );
    renderAdmin();
    await screen.findByText("Nike SS26");

    // Then: search is reachable before the refresh-all action in the same toolbar
    const search = screen.getByLabelText("Search pacings by name or slug");
    const refreshButton = screen.getByRole("button", { name: /refresh all dashboards/i });
    expect(
      search.compareDocumentPosition(refreshButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // When: searching by slug
    await userEvent.type(search, "service-experts");

    // Then:
    await waitFor(() => expect(screen.queryByText("Nike SS26")).not.toBeInTheDocument());
    expect(screen.getByText("Service Experts Q1")).toBeInTheDocument();
  });

  it("names the pacing in the single-delete confirmation and requires typing it exactly", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({ pacings: [aPacingRowV1({ id: "p1", name: "Nike SS26", dashSlug: "nike-ss26" })] })
    );
    vi.mocked(adminApi.deletePacing).mockResolvedValue(undefined);
    renderAdmin();
    await screen.findByText("Nike SS26");

    // When: opening the delete confirmation
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    // Then: the pacing's name and slug are named, and irreversibility is stated
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/nike ss26/i).length).toBeGreaterThan(0);
    expect(within(dialog).getByText("nike-ss26")).toBeInTheDocument();
    expect(within(dialog).getByText(/no undo/i)).toBeInTheDocument();

    // Then: the danger action starts disabled
    const confirmButton = within(dialog).getByRole("button", { name: /delete permanently/i });
    expect(confirmButton).toBeDisabled();

    // When: typing something other than the exact name
    const input = within(dialog).getByPlaceholderText("Nike SS26");
    await userEvent.type(input, "nike ss26");
    expect(confirmButton).toBeDisabled();

    // When: typing the exact name
    await userEvent.clear(input);
    await userEvent.type(input, "Nike SS26");
    expect(confirmButton).toBeEnabled();

    // When: confirming
    await userEvent.click(confirmButton);

    // Then:
    await waitFor(() => expect(adminApi.deletePacing).toHaveBeenCalledWith("p1"));
  });

  it("names and counts every selected pacing in the bulk-delete confirmation", async () => {
    // Given: eight pacings behind one "are you sure" is how an accident becomes eight accidents
    vi.mocked(listPacingOverview).mockResolvedValue(
      aPacingListResponseV1({
        pacings: [
          aPacingRowV1({ id: "p1", name: "Nike SS26", dashSlug: "nike-ss26" }),
          aPacingRowV1({ id: "p2", name: "Adidas Fall", dashSlug: "adidas-fall" }),
        ],
      })
    );
    vi.mocked(adminApi.deletePacing).mockResolvedValue(undefined);
    renderAdmin();
    await screen.findByText("Nike SS26");

    // When: selecting both
    await userEvent.click(screen.getByLabelText("Select Nike SS26"));
    await userEvent.click(screen.getByLabelText("Select Adidas Fall"));
    await userEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    // Then: both names are listed, not just a count
    const dialog = await screen.findByRole("dialog", { name: /delete 2 pacings/i });
    expect(within(dialog).getByText("Nike SS26")).toBeInTheDocument();
    expect(within(dialog).getByText("Adidas Fall")).toBeInTheDocument();

    // Then: the danger action starts disabled until "DELETE" is typed
    const confirmButton = within(dialog).getByRole("button", { name: /delete 2 pacings/i });
    expect(confirmButton).toBeDisabled();
    await userEvent.type(within(dialog).getByPlaceholderText("DELETE"), "DELETE");
    expect(confirmButton).toBeEnabled();

    // When: confirming
    await userEvent.click(confirmButton);

    // Then: both were sent for deletion
    await waitFor(() => expect(adminApi.deletePacing).toHaveBeenCalledTimes(2));
    expect(adminApi.deletePacing).toHaveBeenCalledWith("p1");
    expect(adminApi.deletePacing).toHaveBeenCalledWith("p2");
  });

  it("says 'started', never 'done', when the Daily Build is triggered", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(aPacingListResponseV1({ pacings: [] }));
    vi.mocked(adminApi.refreshAllDashboards).mockResolvedValue({ status: "started" });
    renderAdmin();
    await screen.findByRole("button", { name: /refresh all dashboards/i });

    // When:
    await userEvent.click(screen.getByRole("button", { name: /refresh all dashboards/i }));

    // Then: never claims the build finished - only that it started
    const message = await screen.findByText(/started/i);
    expect(message.textContent?.toLowerCase()).not.toContain("done");
    expect(message.textContent?.toLowerCase()).not.toContain("finished");
  });

  it("shows Pacing's own cooldown countdown instead of a generic failure on 429", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(aPacingListResponseV1({ pacings: [] }));
    vi.mocked(adminApi.refreshAllDashboards).mockResolvedValue({ status: "cooldown", retryAfterSeconds: 200 });
    renderAdmin();
    await screen.findByRole("button", { name: /refresh all dashboards/i });

    // When:
    await userEvent.click(screen.getByRole("button", { name: /refresh all dashboards/i }));

    // Then:
    await screen.findByRole("button", { name: /refresh all dashboards \(200s\)/i });
  });

  it("runs the IO-number sync and reports its summary in a toast", async () => {
    // Given: the run's summary is the whole result - synchronous, unlike refresh-all
    vi.mocked(listPacingOverview).mockResolvedValue(aPacingListResponseV1({ pacings: [] }));
    vi.mocked(adminApi.backfillOrderNumbers).mockResolvedValue({
      scanned: 614,
      filled: 12,
      alreadyHad: 580,
      skippedNoNumbers: 22,
    });
    renderAdmin();
    await screen.findByRole("button", { name: "Sync IO numbers" });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Sync IO numbers" }));

    // Then: one request, and a human sentence out of the four counters
    await waitFor(() => expect(adminApi.backfillOrderNumbers).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(
        "IO numbers: 12 filled in, 580 already had one, 22 have no order numbers on their line items (614 pacings checked)."
      )
    ).toBeInTheDocument();
  });

  it("leaves the skipped part out of the summary when nothing was skipped", async () => {
    // Given: the common repeat-press outcome - fill-only means zero filled, nothing skipped
    vi.mocked(listPacingOverview).mockResolvedValue(aPacingListResponseV1({ pacings: [] }));
    vi.mocked(adminApi.backfillOrderNumbers).mockResolvedValue({
      scanned: 614,
      filled: 0,
      alreadyHad: 614,
      skippedNoNumbers: 0,
    });
    renderAdmin();
    await screen.findByRole("button", { name: "Sync IO numbers" });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Sync IO numbers" }));

    // Then: "0 have no order numbers" would be noise, so the sentence drops it
    expect(
      await screen.findByText("IO numbers: 0 filled in, 614 already had one (614 pacings checked).")
    ).toBeInTheDocument();
  });

  it("reports an IO-number sync failure as an error toast", async () => {
    // Given:
    vi.mocked(listPacingOverview).mockResolvedValue(aPacingListResponseV1({ pacings: [] }));
    vi.mocked(adminApi.backfillOrderNumbers).mockRejectedValue(new Error("boom"));
    renderAdmin();
    await screen.findByRole("button", { name: "Sync IO numbers" });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Sync IO numbers" }));

    // Then:
    expect(await screen.findByText("Could not sync IO numbers.")).toBeInTheDocument();
  });
});
