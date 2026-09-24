import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingLineItemPlanV1, aPacingNotifySettingsV1 } from "@/test/factories";
import * as dashApi from "./api";
import * as planApi from "../pacing-plan/api";
import { PacingSettingsDrawer } from "./pacing-settings-drawer";

/**
 * One Save over three endpoints.
 *
 * The rules under test are the ones a shared footer creates and three separate panels never had to
 * answer: only the dirty sections are written, a section that fails is named rather than folding
 * into one "save failed", and closing with unsaved work asks first.
 */

vi.mock("./api", () => ({
  savePacingDataSettings: vi.fn(),
  savePacingDisplay: vi.fn(),
  savePacingNotifySettings: vi.fn(),
  listPacingLibrary: vi.fn(),
  createPacingLibraryEntry: vi.fn(),
  updatePacingLibraryEntry: vi.fn(),
  deletePacingLibraryEntry: vi.fn(),
  setPacingLibraryLike: vi.fn(),
}));
vi.mock("../pacing-plan/api", () => ({
  savePacingPlan: vi.fn(),
  getAddablePacingLineItems: vi.fn(),
  validatePacingLineItemsById: vi.fn(),
  updatePacingStatus: vi.fn(),
}));

function renderDrawer(overrides: Partial<Parameters<typeof PacingSettingsDrawer>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <PacingSettingsDrawer
        open
        onClose={onClose}
        onSaved={onSaved}
        slug="nike-ss26"
        currency="USD"
        planByLineItem={{ "111": aPacingLineItemPlanV1({ lineItemId: "111", plannedImpressions: 1_000_000 }) }}
        data={{ source: "platform_mart" }}
        display={{ rev: 3, widgets: [], groups: [] }}
        capabilities={{ contextWidgetSpec: 2 }}
        isAdmin={false}
        {...overrides}
      />
    </QueryClientProvider>
  );
  return { onClose, onSaved };
}

/** Puts the data section in a dirty state - the cheapest edit of the three.
 *
 *  Tabs are matched by prefix, not exactly: a dirty tab carries a dot whose label joins its
 *  accessible name ("Data, unsaved changes"), which is the point of the dot for anyone not looking
 *  at the colour. */
async function editDataSource() {
  await userEvent.click(screen.getByRole("button", { name: /^Data/ }));
  await userEvent.click(screen.getByRole("radio", { name: /With manual adjustments/ }));
}

describe("PacingSettingsDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dashApi.savePacingDataSettings).mockResolvedValue(undefined);
    vi.mocked(dashApi.savePacingNotifySettings).mockResolvedValue(undefined);
    vi.mocked(dashApi.listPacingLibrary).mockResolvedValue([]);
    vi.mocked(planApi.getAddablePacingLineItems).mockResolvedValue({ ok: true, addable: [], alreadyAdded: [] });
    vi.mocked(planApi.savePacingPlan).mockResolvedValue({ saved: true });
  });

  it("should keep Save inert until some section has an edit", async () => {
    // Given:
    renderDrawer();

    // Then: an empty save is three requests that write nothing
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();

    // When:
    await editDataSource();

    // Then:
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("should write only the sections that changed", async () => {
    // Given: an edit in Data and nothing else
    const { onClose, onSaved } = renderDrawer();
    await editDataSource();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: the untouched plan and display are not written. A save that touches all three every
    // time would bump the display's revision on a pacing nobody re-laid-out, and every other open
    // editor would start reporting a conflict that never happened.
    await waitFor(() => expect(dashApi.savePacingDataSettings).toHaveBeenCalledTimes(1));
    expect(planApi.savePacingPlan).not.toHaveBeenCalled();
    expect(dashApi.savePacingDisplay).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("should name the section that failed and stay open", async () => {
    // Given: Pacing refusing the data save
    vi.mocked(dashApi.savePacingDataSettings).mockRejectedValue(new Error("devices: unknown catalog"));
    const { onClose } = renderDrawer();
    await editDataSource();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: which section, and what it said. Closing here would throw away the edit the user still
    // has to fix.
    expect(await screen.findByText(/Data: devices: unknown catalog/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("should ask before closing on unsaved work", async () => {
    // Given: an edit in flight
    const { onClose } = renderDrawer();
    await editDataSource();

    // When: the drawer is closed
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    // Then: a silent discard is the one outcome an editor must never produce
    expect(await screen.findByText(/Closing now loses them/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // When: the discard is confirmed
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    // Then:
    expect(onClose).toHaveBeenCalled();
  });

  it("should close without asking when nothing is dirty", async () => {
    // Given:
    const { onClose } = renderDrawer();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    // Then: a confirm with nothing to confirm is a click tax
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText(/Closing now loses them/)).not.toBeInTheDocument();
  });

  it("should drop the draft on Reset", async () => {
    // Given: an edit
    renderDrawer();
    await editDataSource();
    expect(screen.getByRole("radio", { name: /With manual adjustments/ })).toBeChecked();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    // Then: back to what the server last said, and nothing left to save
    expect(screen.getByRole("radio", { name: /Raw delivery/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("should keep a section's draft alive while another tab is shown", async () => {
    // Given: an edit in Data
    renderDrawer();
    await editDataSource();

    // When: the user looks at the plan and comes back
    await userEvent.click(screen.getByRole("button", { name: /^Plan/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Data/ }));

    // Then: the edit survived. One Save over three sections only works if the two the user is not
    // looking at still hold their drafts - unmounting them would discard two thirds of the work on
    // a tab click.
    expect(screen.getByRole("radio", { name: /With manual adjustments/ })).toBeChecked();
  });

  it("should show a fourth Alerts tab and write it alone when it is the only edit (§14)", async () => {
    // Given: a pacing with a stored alert configuration
    const { onSaved } = renderDrawer({ notify: aPacingNotifySettingsV1(), hasVideo: false });

    // When: only the Alerts tab is touched
    await userEvent.click(screen.getByRole("button", { name: /^Alerts/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Send alerts to Slack" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: notify is a whole-object replace (unlike Data's per-key patch above), so the request still
    // carries every one of the 13 alert keys - not just the one the user touched.
    await waitFor(() => expect(dashApi.savePacingNotifySettings).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(dashApi.savePacingNotifySettings).mock.calls[0];
    expect(Object.keys(body.alerts)).toHaveLength(14); // 13 detectors + the master switch
    expect(dashApi.savePacingDataSettings).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });
});
