import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updatePacingStatus } from "./api";
import { StatusControl } from "./status-control";

vi.mock("./api", () => ({
  updatePacingStatus: vi.fn(),
}));

function renderControl(pacingId = "p1", status = "Live") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StatusControl pacingId={pacingId} status={status} />
    </QueryClientProvider>
  );
}

describe("StatusControl", () => {
  beforeEach(() => {
    vi.mocked(updatePacingStatus).mockReset();
  });

  it("changes status to any of Live/Paused/Complete/Archive (US-128)", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(updatePacingStatus).mockResolvedValue(undefined);
    renderControl("p1", "Live");

    // When:
    await user.selectOptions(screen.getByLabelText("Change pacing status"), "Archive");

    // Then:
    await waitFor(() => expect(updatePacingStatus).toHaveBeenCalledWith("p1", "Archive"));
  });

  it("surfaces a failure instead of silently reverting", async () => {
    // Given:
    const user = userEvent.setup();
    vi.mocked(updatePacingStatus).mockRejectedValue(new Error("boom"));
    renderControl("p1", "Live");

    // When:
    await user.selectOptions(screen.getByLabelText("Change pacing status"), "Paused");

    // Then:
    await screen.findByText("boom");
  });
});
