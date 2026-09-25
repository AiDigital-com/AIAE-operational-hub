import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingNotifySettingsV1 } from "@/test/factories";
import * as api from "./api";
import { PacingAlertsSection, computeHasVideo } from "./alerts-panel";
import type { SettingsSectionHandle } from "./settings-section";
import type { PacingLineItemPlanV1, PacingNotifySettingsV1 } from "./types";

vi.mock("./api", () => ({
  savePacingNotifySettings: vi.fn(),
}));

/**
 * The Alerts section with a Save of its own.
 *
 * The real Save is the settings drawer's, shared with the plan/data/widgets sections; its rules
 * (disabled until something is dirty, one error line per failed section) belong to that component
 * and are tested there. Here it is a plain trigger, so these cases stay about the WHOLE-OBJECT
 * contract this section alone has to keep - the thing that makes it different from every sibling
 * section, which sends only what changed.
 */
function renderPanel(notify: PacingNotifySettingsV1 | undefined, hasVideo = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  function Harness() {
    const ref = useRef<SettingsSectionHandle>(null);
    const [error, setError] = useState<string | null>(null);
    return (
      <>
        <PacingAlertsSection
          ref={ref}
          slug="nike-ss26"
          notify={notify}
          hasVideo={hasVideo}
          seedKey={1}
          onDirtyChange={() => {}}
        />
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

describe("computeHasVideo", () => {
  it("is true for a CPV line item even with no VCR target", () => {
    const li = { lineItemId: "1", rateType: "CPV" } as PacingLineItemPlanV1;
    expect(computeHasVideo({ "1": li })).toBe(true);
  });

  it("is true for a line item carrying a VCR target regardless of rate type", () => {
    const li = { lineItemId: "1", rateType: "CPM", vcrTargetPct: 65 } as PacingLineItemPlanV1;
    expect(computeHasVideo({ "1": li })).toBe(true);
  });

  it("is false when nothing on the pacing is video", () => {
    const li = { lineItemId: "1", rateType: "CPM" } as PacingLineItemPlanV1;
    expect(computeHasVideo({ "1": li })).toBe(false);
  });
});

describe("PacingAlertsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.savePacingNotifySettings).mockResolvedValue(undefined);
  });

  it("defaults the master switch off and every detector on for a pacing with no stored notify", () => {
    // Given: a pacing nothing has ever configured - matches defaultNotify()'s own "legacy semantic".
    renderPanel(undefined);

    expect(screen.getByRole("checkbox", { name: "Send alerts to Slack" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Enable Margin below target" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Enable Stale data" })).toBeChecked();
  });

  it("shows the stored thresholds rather than the defaults", async () => {
    renderPanel(
      aPacingNotifySettingsV1({
        alerts: {
          ...aPacingNotifySettingsV1().alerts,
          staleData: { enabled: true, slack: true, days: 5 },
        },
      })
    );

    // The threshold field now lives in the rule's popover - opened by clicking the row.
    await userEvent.click(screen.getByRole("button", { name: "Edit Stale data" }));
    expect(screen.getByRole("spinbutton", { name: "Stale data threshold, days" })).toHaveValue(5);
  });

  it("hides the two video-only rows when the pacing has no video", () => {
    renderPanel(aPacingNotifySettingsV1(), false);

    expect(screen.queryByText("VCR over 100%")).not.toBeInTheDocument();
    expect(screen.queryByText("VCR vs target")).not.toBeInTheDocument();
  });

  it("shows the two video-only rows when the pacing has video", () => {
    renderPanel(aPacingNotifySettingsV1(), true);

    expect(screen.getByText("VCR over 100%")).toBeInTheDocument();
    expect(screen.getByText("VCR vs target")).toBeInTheDocument();
  });

  it("sends the whole configuration, not a patch, when only one field changed", async () => {
    // Given: Pacing stores `notify` as one unit and refuses a save missing any of the 13 keys - unlike
    // the data-settings save, there is no "only what changed" here.
    renderPanel(aPacingNotifySettingsV1());

    await userEvent.click(screen.getByRole("checkbox", { name: "Send alerts to Slack" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.savePacingNotifySettings).toHaveBeenCalledTimes(1));
    const [slug, body] = vi.mocked(api.savePacingNotifySettings).mock.calls[0];
    expect(slug).toBe("nike-ss26");
    // The factory seeds the master switch on; one click turns it off.
    expect(body.alerts.enabled).toBe(false);
    // Every other key still rode along, unedited but present - a partial object would be silently
    // read by Pacing's validator as "every omitted key is disabled".
    expect(body.alerts.staleData).toEqual({ enabled: true, slack: true, days: 2 });
    expect(body.alerts.pacingOffPace).toEqual({ enabled: true, slack: true, low: -5, high: 5 });
    expect(body.metrics).toEqual({ vcr: false });
    expect(body.hidePaused).toBe(false);
    expect(body.summaryProjection).toBe("reforecast");
  });

  it("converts a percent-of-target threshold back to the stored factor", async () => {
    renderPanel(aPacingNotifySettingsV1());

    await userEvent.click(screen.getByRole("button", { name: "Edit CTR vs target" }));
    const field = screen.getByRole("spinbutton", { name: "CTR lower bound, percent of target" });
    await userEvent.clear(field);
    await userEvent.type(field, "60");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.savePacingNotifySettings).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.savePacingNotifySettings).mock.calls[0];
    expect(body.alerts.ctrBelowTarget.factor).toBeCloseTo(0.6);
  });

  it("falls back to the last-saved value when a threshold field is left blank", async () => {
    renderPanel(aPacingNotifySettingsV1());

    await userEvent.click(screen.getByRole("button", { name: "Edit Stale data" }));
    const field = screen.getByRole("spinbutton", { name: "Stale data threshold, days" });
    await userEvent.clear(field);
    // Something else has to be dirty, or Save is a no-op with nothing to send.
    await userEvent.click(screen.getByRole("checkbox", { name: "Send alerts to Slack" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.savePacingNotifySettings).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.savePacingNotifySettings).mock.calls[0];
    expect(body.alerts.staleData.days).toBe(2);
  });

  it("shows a legacy half-enabled CTR band as mixed without changing it", () => {
    // Given: only the lower bound is on - a state canon explicitly tolerates rather than "fixing" on
    // load.
    renderPanel(
      aPacingNotifySettingsV1({
        alerts: {
          ...aPacingNotifySettingsV1().alerts,
          ctrBelowTarget: { enabled: true, slack: true, factor: 0.7 },
          ctrAboveTarget: { enabled: false, slack: true, factor: 2.0 },
        },
      })
    );

    const checkbox = screen.getByRole("checkbox", { name: "Enable CTR vs target" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.indeterminate).toBe(true);
  });

  it("turns a mixed CTR band fully on with one click", async () => {
    renderPanel(
      aPacingNotifySettingsV1({
        alerts: {
          ...aPacingNotifySettingsV1().alerts,
          ctrBelowTarget: { enabled: true, slack: true, factor: 0.7 },
          ctrAboveTarget: { enabled: false, slack: true, factor: 2.0 },
        },
      })
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "Enable CTR vs target" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.savePacingNotifySettings).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.savePacingNotifySettings).mock.calls[0];
    expect(body.alerts.ctrBelowTarget.enabled).toBe(true);
    expect(body.alerts.ctrAboveTarget.enabled).toBe(true);
  });

  it("does not call the endpoint at all when nothing changed", async () => {
    renderPanel(aPacingNotifySettingsV1());

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(api.savePacingNotifySettings).not.toHaveBeenCalled();
  });

  it("reports a rejection instead of closing", async () => {
    vi.mocked(api.savePacingNotifySettings).mockRejectedValue(
      new Error("alerts.pacing_off_pace.low must be less than .high")
    );
    const { onClose } = renderPanel(aPacingNotifySettingsV1());

    await userEvent.click(screen.getByRole("checkbox", { name: "Send alerts to Slack" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/must be less than/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables Slack for a rule that is off, even when the master switch is on", () => {
    renderPanel(
      aPacingNotifySettingsV1({
        alerts: { ...aPacingNotifySettingsV1().alerts, staleData: { enabled: false, slack: true, days: 2 } },
      })
    );

    expect(screen.getByRole("checkbox", { name: "Slack for Stale data" })).toBeDisabled();
  });

  it("opens a rule's popover on click and closes it on an outside click", async () => {
    renderPanel(aPacingNotifySettingsV1());

    const trigger = screen.getByRole("button", { name: "Edit Stale data" });
    expect(screen.queryByRole("dialog", { name: "Stale data" })).not.toBeInTheDocument();

    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Stale data" })).toBeInTheDocument();

    await userEvent.click(document.body);
    expect(screen.queryByRole("dialog", { name: "Stale data" })).not.toBeInTheDocument();
  });

  it("toggles the enable and Slack checkboxes without opening the rule's popover", async () => {
    renderPanel(aPacingNotifySettingsV1());

    // Slack first, while the rule is still enabled - toggling "enable" off disables this rule's own
    // Slack checkbox, which is a separate, already-covered behaviour, not what this case is about.
    const slackBox = screen.getByRole("checkbox", { name: "Slack for Stale data" });
    await userEvent.click(slackBox);
    expect(slackBox).not.toBeChecked();
    expect(screen.queryByRole("dialog", { name: "Stale data" })).not.toBeInTheDocument();

    const enableBox = screen.getByRole("checkbox", { name: "Enable Stale data" });
    await userEvent.click(enableBox);
    expect(enableBox).not.toBeChecked();
    expect(screen.queryByRole("dialog", { name: "Stale data" })).not.toBeInTheDocument();
  });

  it("shows the default note only where the detector reads a stored zero as its own default", async () => {
    renderPanel(aPacingNotifySettingsV1());

    // ctrBelowTarget: shared/alerts-core.js reads `cfg.factor || 0.7`, so a stored zero silently
    // becomes 0.7 - the note is honest here.
    await userEvent.click(screen.getByRole("button", { name: "Edit CTR vs target" }));
    const ctrField = screen.getByRole("spinbutton", { name: "CTR lower bound, percent of target" });
    expect(screen.queryByText(/Zero uses the default/)).not.toBeInTheDocument();
    await userEvent.clear(ctrField);
    await userEvent.type(ctrField, "0");
    expect(screen.getByText("Zero uses the default: 70% of target for the lower bound.")).toBeInTheDocument();
    await userEvent.clear(ctrField);
    await userEvent.type(ctrField, "60");
    expect(screen.queryByText(/Zero uses the default/)).not.toBeInTheDocument();

    // staleData.days: shared/alerts-core.js reads `cfg.days != null ? cfg.days : 2`, so a stored zero
    // is honored as zero, not read as "use the default" - no note here.
    await userEvent.click(screen.getByRole("button", { name: "Edit Stale data" }));
    const staleField = screen.getByRole("spinbutton", { name: "Stale data threshold, days" });
    await userEvent.clear(staleField);
    await userEvent.type(staleField, "0");
    expect(screen.queryByText(/Zero uses the default/)).not.toBeInTheDocument();
  });
});
