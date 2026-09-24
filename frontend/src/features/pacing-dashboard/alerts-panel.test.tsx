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

  it("shows the stored thresholds rather than the defaults", () => {
    renderPanel(
      aPacingNotifySettingsV1({
        alerts: {
          ...aPacingNotifySettingsV1().alerts,
          staleData: { enabled: true, slack: true, days: 5 },
        },
      })
    );

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
});
