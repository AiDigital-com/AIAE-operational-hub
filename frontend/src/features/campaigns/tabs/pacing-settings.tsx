import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../../../shared/style/cn";
import { CloseIcon, ExpandIcon, InfoIcon } from "../../../shared/ui/icons/icons";
import { Sheet } from "../../../shared/ui/sheet/sheet";
import { Toggle } from "../../../shared/ui/toggle/toggle";
import { useToast } from "../../../shared/ui/toast/toast";
import "./pacing-settings.css";

type PsTabId = "display" | "assets" | "data" | "mapping" | "notifications";

const PS_TABS: Array<{ id: PsTabId; label: string }> = [
  { id: "display", label: "Display" },
  { id: "assets", label: "Assets" },
  { id: "data", label: "Data" },
  { id: "mapping", label: "Mapping" },
  { id: "notifications", label: "Notifications" },
];

const CHART_OPTIONS: Array<[string, boolean]> = [
  ["Cum. Impr", true],
  ["Cum. Spend", true],
  ["Daily Impr", true],
  ["Daily Spend", true],
  ["CTR", true],
  ["VCR/ACR", true],
  ["Cum. Clicks", true],
  ["Daily Clicks", true],
  ["CPC", true],
  ["Cum. Views", false],
  ["Daily Views", false],
  ["CPV", false],
];

const KPI_PRESETS = ["Margin", "Pacing", "Delivery", "CPM", "Spend", "CTR", "VCR", "CPC", "CPV"];

const MAPPING_ROWS: Array<[string, string]> = [
  ["Line item ID", "constructed_name"],
  ["Channel", "channel"],
  ["Cost budget", "cost_budget"],
  ["Flight dates", "flight_start / flight_end"],
  ["Margin target", "margin_target"],
];

interface PacingSettingsProps {
  open: boolean;
  onClose: () => void;
}

/**
 * W6 — the Pacing tab's settings slide-over. Entirely visual for this phase (no real settings
 * persistence layer exists yet): every control is locally interactive but resets to its default the
 * next time the sheet opens, and Save/Reset both just close it.
 */
export function PacingSettings({ open, onClose }: PacingSettingsProps) {
  const [tab, setTab] = useState<PsTabId>("display");
  const toast = useToast();

  useEffect(() => {
    if (open) setTab("display");
  }, [open]);

  function save() {
    toast.showSuccess("Settings saved.");
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Settings"
      className="pacing-settings"
      headerActions={
        <>
          <button type="button" title="Expand" onClick={() => toast.showError("Expand — visual only in this phase.")}>
            <ExpandIcon />
          </button>
          <button type="button" title="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </>
      }
      tabs={
        <>
          {PS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn("pacing-settings__tab", tab === t.id && "pacing-settings__tab--active")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </>
      }
      footer={
        <>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => toast.showError("Pause campaign — out of scope for this phase.")}
          >
            Pause campaign
          </button>
          <div className="pacing-settings__foot-actions">
            <button type="button" className="button button--ghost" onClick={onClose}>
              Reset
            </button>
            <button type="button" className="button button--primary" onClick={save}>
              Save
            </button>
          </div>
        </>
      }
    >
      {tab === "display" && <DisplayTab />}
      {tab === "assets" && <AssetsTab />}
      {tab === "data" && <DataTab />}
      {tab === "mapping" && <MappingTab />}
      {tab === "notifications" && <NotificationsTab />}
    </Sheet>
  );
}

function SectionHeading({ children, badge }: { children: ReactNode; badge?: string }) {
  return (
    <div className="pacing-settings__sec">
      {children}
      {badge && <span className="pacing-settings__count">{badge}</span>}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="pacing-settings__note">
      <InfoIcon />
      {children}
    </div>
  );
}

function DisplayTab() {
  const [charts, setCharts] = useState<Map<string, boolean>>(() => new Map(CHART_OPTIONS));
  const [showDescription, setShowDescription] = useState(false);
  const toast = useToast();

  function toggleChart(label: string) {
    setCharts((current) => {
      const next = new Map(current);
      next.set(label, !next.get(label));
      return next;
    });
  }

  return (
    <>
      <SectionHeading>Charts</SectionHeading>
      <div className="pacing-settings__charts">
        {[...charts.entries()].map(([label, checked]) => (
          <label key={label} className="pacing-settings__check">
            <input type="checkbox" checked={checked} onChange={() => toggleChart(label)} />
            {label}
          </label>
        ))}
      </div>

      <SectionHeading>KPI presets</SectionHeading>
      <div className="pacing-settings__presets">
        {KPI_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="pacing-settings__chip"
            onClick={() => toast.showError(`Add "${preset}" widget — visual only in this phase.`)}
          >
            + {preset}
          </button>
        ))}
      </div>

      <SectionHeading badge="0 of 40">Custom widgets</SectionHeading>
      <button
        type="button"
        className="pacing-settings__widgets"
        onClick={() => toast.showError("Add widget — visual only in this phase.")}
      >
        + Add widget
      </button>

      <SectionHeading>Line items</SectionHeading>
      <label className="pacing-settings__check">
        <input
          type="checkbox"
          checked={showDescription}
          onChange={(event) => setShowDescription(event.target.checked)}
        />
        Show description
      </label>
    </>
  );
}

function AssetsTab() {
  const [thumbnails, setThumbnails] = useState(true);
  const [groupByPlacement, setGroupByPlacement] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const toast = useToast();

  return (
    <>
      <Note>Control the creative assets surfaced in reports and dashboards.</Note>
      <Toggle
        checked={thumbnails}
        onChange={setThumbnails}
        label="Show creative thumbnails"
        sub="Display preview images next to line items"
      />
      <Toggle checked={groupByPlacement} onChange={setGroupByPlacement} label="Group assets by placement" />
      <Toggle checked={includeArchived} onChange={setIncludeArchived} label="Include archived creatives" />
      <button
        type="button"
        className="pacing-settings__widgets pacing-settings__widgets--tall"
        onClick={() => toast.showError("Add asset group — visual only in this phase.")}
      >
        + Add asset group
      </button>
    </>
  );
}

function DataTab() {
  const [excludeIvt, setExcludeIvt] = useState(true);
  const [backfill, setBackfill] = useState(false);

  return (
    <>
      <Note>Plan data is managed in Campaign Setup.</Note>
      <div className="pacing-settings__row">
        <span className="pacing-settings__row-label">BigQuery source</span>
        <code className="pacing-settings__code">silken-quasar-376417.gs_templates.pacing_fact</code>
      </div>
      <div className="pacing-settings__row">
        <span className="pacing-settings__row-label">Refresh cadence</span>
        <span>Every 6 hours</span>
      </div>
      <Toggle
        checked={excludeIvt}
        onChange={setExcludeIvt}
        label="Exclude invalid traffic (IVT)"
        sub="Remove flagged impressions from actuals"
      />
      <Toggle checked={backfill} onChange={setBackfill} label="Backfill missing days" />
    </>
  );
}

function MappingTab() {
  return (
    <>
      <Note>How NetSuite plan fields map to delivery data.</Note>
      {MAPPING_ROWS.map(([label, code]) => (
        <div key={label} className="pacing-settings__row">
          <span className="pacing-settings__row-label">{label}</span>
          <code className="pacing-settings__code">{code}</code>
        </div>
      ))}
    </>
  );
}

function NotificationsTab() {
  const [pacingOffTrack, setPacingOffTrack] = useState(true);
  const [marginBelowTarget, setMarginBelowTarget] = useState(true);
  const [noData, setNoData] = useState(false);
  const [flightEnding, setFlightEnding] = useState(false);
  const [weeklyDigest, setWeeklyDigest] = useState(true);

  return (
    <>
      <Toggle
        checked={pacingOffTrack}
        onChange={setPacingOffTrack}
        label="Pacing off-track"
        sub="Notify when a line item drifts beyond ±10 pp"
      />
      <Toggle checked={marginBelowTarget} onChange={setMarginBelowTarget} label="Margin below target" />
      <Toggle
        checked={noData}
        onChange={setNoData}
        label="No data received"
        sub="Notify after 24h with no delivery"
      />
      <Toggle
        checked={flightEnding}
        onChange={setFlightEnding}
        label="Flight ending soon"
        sub="Notify 3 days before flight end"
      />
      <SectionHeading>Delivery</SectionHeading>
      <Toggle checked={weeklyDigest} onChange={setWeeklyDigest} label="Weekly pacing digest" sub="Email every Monday 08:00" />
    </>
  );
}
