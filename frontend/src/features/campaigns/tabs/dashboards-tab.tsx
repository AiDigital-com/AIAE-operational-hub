import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { formatError } from "../../../shared/format/error";
import { cn } from "../../../shared/style/cn";
import { PlusIcon, TrashIcon } from "../../../shared/ui/icons/icons";
import { LoadingBlock } from "../../../shared/ui/loading-spinner/loading-spinner";
import { Modal } from "../../../shared/ui/modal/modal";
import { toPacingCampaign } from "../../pacing/mock/adapter";
import { useDashSources } from "../../pacing/mock/hooks";
import { bqName } from "../../pacing/mock/reports";
import type { CampaignV1 } from "../types";
import type { CampaignTabContext } from "../campaign-workspace";
import "./dashboards-tab.css";

const WIZARD_STEPS = ["Report type", "Breakdown", "Review"] as const;
const SOON_REPORT_TYPES = ["Conversions", "Geo", "Keywords", "Business outcomes"];

function fmtShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}

/**
 * W5 — the Dashboards tab manages *external Clicdata BQ data sources* (a config table), not the pacing
 * dashboard itself (that's the Pacing tab, W2). Both are mock for now; see
 * 03-REAL-DASHBOARD-INTEGRATION.md for how the real pacing-src dashboards eventually slot in.
 */
export function DashboardsTab() {
  const { campaign } = useOutletContext<CampaignTabContext>();
  const dash = useDashSources(campaign);
  const [wizardOpen, setWizardOpen] = useState(false);

  if (dash.isPending) {
    return <LoadingBlock label="Loading dashboards" />;
  }
  if (dash.isError) {
    return <p className="form-error">{formatError(dash.error)}</p>;
  }

  const basicUsed = dash.sources.some((source) => source.type === "basic");

  return (
    <div className="dashboards-tab">
      <div className="dashboards-tab__head">
        <div>
          <h2 className="dashboards-tab__title">Dashboards</h2>
          <div className="dashboards-tab__sub">
            {dash.sources.length} data source{dash.sources.length !== 1 ? "s" : ""}
          </div>
        </div>
        <button type="button" className="button button--primary button--sm" onClick={() => setWizardOpen(true)}>
          <PlusIcon />
          Create data source
        </button>
      </div>

      <div className="dashboards-tab__note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v.5M11 12h1v4h1" />
        </svg>
        Data sources are BigQuery tables that power dashboards in Clicdata. One data source can be
        created per report type.
      </div>

      {dash.sources.length === 0 ? (
        <div className="dashboards-tab__empty">
          <h3>Create your first data source</h3>
          <p>A short wizard walks you through report type, breakdown level and review.</p>
          <button type="button" className="button button--primary" onClick={() => setWizardOpen(true)}>
            Create data source
          </button>
        </div>
      ) : (
        <div className="dashboards-tab__tbl-wrap">
          <table className="dashboards-tab__tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Breakdown</th>
                <th>BQ table</th>
                <th>Created</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {dash.sources.map((source) => (
                <tr key={source.id}>
                  <td className="dashboards-tab__name">{source.name}</td>
                  <td><span className="dashboards-tab__tag">Basic</span></td>
                  <td>{source.breakdown === "creative" ? "Creative" : "Line item"}</td>
                  <td>
                    <code className="dashboards-tab__code" title={source.table}>{source.table}</code>
                  </td>
                  <td className="dashboards-tab__flight">{fmtShort(source.created)}</td>
                  <td>
                    <span className="dashboards-tab__status">
                      <span className="dashboards-tab__led" />
                      Active
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="dashboards-tab__trash"
                      aria-label={`Delete ${source.name}`}
                      onClick={() => dash.deleteDashSource(source.id)}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DashWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        campaign={campaign}
        basicUsed={basicUsed}
        onCreate={dash.createDashSource}
      />
    </div>
  );
}

interface DashWizardProps {
  open: boolean;
  onClose: () => void;
  campaign: CampaignV1;
  basicUsed: boolean;
  onCreate: (breakdown: "creative" | "line_item") => void;
}

/** The multi-step "Create data source" wizard (report type -> breakdown -> review), on the shared Modal. */
function DashWizard({ open, onClose, campaign, basicUsed, onCreate }: DashWizardProps) {
  const [step, setStep] = useState(1);
  const [breakdown, setBreakdown] = useState<"creative" | "line_item">("creative");

  useEffect(() => {
    if (open) {
      setStep(1);
      setBreakdown("creative");
    }
  }, [open]);

  const table = bqName(toPacingCampaign(campaign), "basic") + (breakdown === "line_item" ? "_li" : "");
  const canAdvance = step > 1 || !basicUsed;

  function create() {
    onCreate(breakdown);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create data source"
      subtitle="A BigQuery table that powers a Clicdata dashboard."
      className="dashboards-tab__wiz-card"
    >
      <div className="dashboards-tab__wiz-steps">
        {WIZARD_STEPS.map((label, index) => {
          const n = index + 1;
          return (
            <span
              key={label}
              className={cn(
                "dashboards-tab__wiz-step",
                step === n && "dashboards-tab__wiz-step--active",
                step > n && "dashboards-tab__wiz-step--done"
              )}
            >
              <span className="dashboards-tab__wiz-step-n">{step > n ? "✓" : n}</span>
              {label}
            </span>
          );
        })}
      </div>

      {step === 1 && (
        <>
          <div className={cn("dashboards-tab__wiz-opt", "dashboards-tab__wiz-opt--selected", basicUsed && "dashboards-tab__wiz-opt--disabled")}>
            <span>Basic</span>
            {basicUsed && <span className="dashboards-tab__wiz-chip">Already created</span>}
          </div>
          {SOON_REPORT_TYPES.map((label) => (
            <div key={label} className="dashboards-tab__wiz-opt dashboards-tab__wiz-opt--disabled">
              <span>{label}</span>
              <span className="dashboards-tab__wiz-chip">Coming soon</span>
            </div>
          ))}
        </>
      )}

      {step === 2 && (
        <>
          <button
            type="button"
            className={cn("dashboards-tab__wiz-opt", breakdown === "creative" && "dashboards-tab__wiz-opt--selected")}
            onClick={() => setBreakdown("creative")}
          >
            <span>Creative<span className="dashboards-tab__wiz-sub">One row per creative — most granular</span></span>
          </button>
          <button
            type="button"
            className={cn("dashboards-tab__wiz-opt", breakdown === "line_item" && "dashboards-tab__wiz-opt--selected")}
            onClick={() => setBreakdown("line_item")}
          >
            <span>Line item<span className="dashboards-tab__wiz-sub">Aggregated totals per line item</span></span>
          </button>
          <div className="dashboards-tab__hint">
            Equivalent to &ldquo;Do you need a creatives breakdown?&rdquo; in the Google Sheets template.
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="dashboards-tab__wiz-review">
            <div className="dashboards-tab__ps-row"><span className="dashboards-tab__ps-label">Report type</span><span className="dashboards-tab__tag">Basic</span></div>
            <div className="dashboards-tab__ps-row"><span className="dashboards-tab__ps-label">Breakdown</span><span>{breakdown === "creative" ? "Creative" : "Line item"}</span></div>
            <div className="dashboards-tab__ps-row"><span className="dashboards-tab__ps-label">BQ table</span><code className="dashboards-tab__ps-code">{table}</code></div>
            <div className="dashboards-tab__ps-row"><span className="dashboards-tab__ps-label">Refresh</span><span>Every 6 hours</span></div>
          </div>
          <div className="dashboards-tab__hint">
            Runs the same job as &ldquo;Transfer data to BQ&rdquo; in the Google Sheets template. A data
            source can be created once per report type.
          </div>
        </>
      )}

      <div className="dashboards-tab__wiz-foot">
        <button type="button" className="button button--ghost" onClick={onClose}>Cancel</button>
        <div className="dashboards-tab__wiz-foot-right">
          {step > 1 && (
            <button type="button" className="button button--ghost" onClick={() => setStep((s) => s - 1)}>Back</button>
          )}
          {step < 3 ? (
            <button
              type="button"
              className="button button--primary"
              disabled={!canAdvance}
              onClick={() => setStep((s) => Math.min(3, s + 1))}
            >
              Next
            </button>
          ) : (
            <button type="button" className="button button--primary" onClick={create}>Create data source</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
