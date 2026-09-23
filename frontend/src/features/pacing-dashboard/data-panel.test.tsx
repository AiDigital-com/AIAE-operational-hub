import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { PacingDataSection } from "./data-panel";
import type { SettingsSectionHandle } from "./settings-section";
import type { PacingDataShape } from "./types";

vi.mock("./api", () => ({
  savePacingDataSettings: vi.fn(),
}));

/**
 * The data section with a Save of its own.
 *
 * The real Save is the settings drawer's, shared with the plan and widget sections; its rules
 * (disabled until something is dirty, one error line per failed section) belong to that component
 * and are tested there. Here it is a plain trigger, so these cases stay about which keys the
 * section sends.
 */
function renderPanel(data: PacingDataShape | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  function Harness() {
    const ref = useRef<SettingsSectionHandle>(null);
    const [error, setError] = useState<string | null>(null);
    return (
      <>
        <PacingDataSection ref={ref} slug="nike-ss26" data={data} seedKey={1} onDirtyChange={() => {}} />
        {error && <p className="form-error">{error}</p>}
        <button
          type="button"
          onClick={async () => {
            const result = await ref.current?.save();
            if (result?.ok) onClose();
            else if (result) setError(result.message);
          }}
        >
          Save
        </button>
      </>
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  );
  return { onClose };
}

describe("PacingDataSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.savePacingDataSettings).mockResolvedValue(undefined);
  });

  it("should show the stored BigQuery source as the selected option", () => {
    // Given: a pacing reading the manual-adjustments view
    renderPanel({ source: "platform_mart_adjustments_view" });

    // Then: the radio reflects the table its delivery query actually reads
    expect(screen.getByRole("radio", { name: /With manual adjustments/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Raw delivery/ })).not.toBeChecked();
  });

  it("should fall back to the raw mart when the namespace has never been written", () => {
    // Given: a pacing that predates the BigQuery-direct migration. Pacing's own refresh substitutes
    // platform_mart for an absent source, so showing no selection would hide where the numbers come
    // from - which is the whole failure this panel exists to make visible.
    renderPanel(undefined);

    // Then:
    expect(screen.getByRole("radio", { name: /Raw delivery/ })).toBeChecked();
  });

  it("should send only the source when that is all the user changed", async () => {
    // Given: a pacing with extras on and a sheet-backed dimension source
    renderPanel({
      source: "platform_mart",
      fetch_creatives: true,
      dim_sources: [{ id: "dv_apps", loader: "sheet" }],
    });

    // When: only the radio moves
    await userEvent.click(screen.getByRole("radio", { name: /With manual adjustments/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: Pacing merges per key, so an untouched setting must not appear in the request at all -
    // sending dimSources here would replace the whole list on a save about something else.
    await waitFor(() => expect(api.savePacingDataSettings).toHaveBeenCalledTimes(1));
    expect(api.savePacingDataSettings).toHaveBeenCalledWith("nike-ss26", {
      source: "platform_mart_adjustments_view",
    });
  });

  it("should carry through a dimension source it does not own when the Devices box is ticked", async () => {
    // Given: a pacing with a sheet-backed source this panel has no control for
    renderPanel({ source: "platform_mart", dim_sources: [{ id: "dv_apps", loader: "sheet" }] });

    // When:
    await userEvent.click(screen.getByRole("button", { name: /Additional data/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Devices dimension/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: the list is a whole-array replace, so the entry this panel does not own rides along -
    // rebuilding from the checkbox alone would delete it on a click that has nothing to do with it.
    await waitFor(() => expect(api.savePacingDataSettings).toHaveBeenCalledTimes(1));
    expect(api.savePacingDataSettings).toHaveBeenCalledWith("nike-ss26", {
      dimSources: {
        entries: [
          { id: "devices", loader: "bq_mart", origin: { catalog: "devices" } },
          { id: "dv_apps", loader: "sheet" },
        ],
      },
    });
  });

  it("should send a false fetch toggle rather than omitting it", async () => {
    // Given: an extra currently on
    renderPanel({ source: "platform_mart", fetch_creatives: true });

    // When: it is switched off
    await userEvent.click(screen.getByRole("button", { name: /Additional data/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Fetch DSP creative assets/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: false is a value to write. Dropping it because it is falsy would make the toggle one-way.
    await waitFor(() => expect(api.savePacingDataSettings).toHaveBeenCalledTimes(1));
    expect(api.savePacingDataSettings).toHaveBeenCalledWith("nike-ss26", { fetchCreatives: false });
  });

  it("should not call the endpoint at all when nothing changed", async () => {
    // Given: an untouched section
    renderPanel({ source: "platform_mart_adjustments_view" });

    // When: saved anyway - which is what the drawer's single Save does to every section, dirty or
    // not, when a sibling is the one with edits
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: an empty patch is a request that writes nothing
    expect(api.savePacingDataSettings).not.toHaveBeenCalled();
  });

  it("should report a rejection instead of closing", async () => {
    // Given: Pacing refusing the save
    vi.mocked(api.savePacingDataSettings).mockRejectedValue(new Error("devices: unknown catalog"));
    const { onClose } = renderPanel({ source: "platform_mart" });

    // When:
    await userEvent.click(screen.getByRole("radio", { name: /With manual adjustments/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: the panel stays open with the edit intact, so the user can see what was refused
    expect(await screen.findByText(/unknown catalog/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
