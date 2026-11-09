/**
 * A pacing's alerts, as the reference draws them: `AlertsBlock.jsx` on `ogan-team`
 * (`workspace/src/pages/Dashboard/components/AlertsBlock.jsx`), "Critical → cards in a tight
 * grid, warning → compact pill line. When critical=0, warning rises to cards."
 *
 * Two groups only, Critical and Warning. `info` alerts (today only `data_gap`) go into Warning
 * with the warnings, exactly as the reference bundles them ("bundle 'warning' + 'info'
 * together"). This block used to give them a third group, "Notes", which the reference never had.
 *
 * `value` and `label` come from Pacing (its own `AlertsCore.displayParts`), so the per-detector
 * formatting rules are not duplicated here. `text` is kept as the title attribute.
 */
import { useState, type KeyboardEvent } from "react";
import { cn } from "../../shared/style/cn";
import type { PacingAlertV1 } from "./types";
import "./alerts-block.css";

/** How many warnings the pill line shows before "+ N more". The reference's WARNING_VISIBLE. */
const WARNING_VISIBLE = 5;

type CardSeverity = "critical" | "warning";

function alertKey(alert: PacingAlertV1, index: number): string {
  return `${alert.type}|${alert.liId ?? "campaign"}|${index}`;
}

function GroupHead({ severity, count }: { severity: CardSeverity; count: number }) {
  return (
    <div className={cn("alerts__head", `alerts__head--${severity}`)}>
      <span>{severity === "critical" ? "Critical" : "Warning"}</span>
      <span className="alerts__head-count">{count}</span>
    </div>
  );
}

type SelectProps = {
  active: boolean;
  onSelect?: (liId: string) => void;
};

/** A line item's alert filters the page to that line item on click, as in the reference. */
function clickProps(alert: PacingAlertV1, onSelect?: (liId: string) => void) {
  const liId = alert.liId;
  if (!liId || !onSelect) return {};
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: () => onSelect(liId),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(liId);
      }
    },
  };
}

function AlertCard({ alert, severity, active, onSelect }: { alert: PacingAlertV1; severity: CardSeverity } & SelectProps) {
  const isCamp = !alert.liId;
  const clickable = !isCamp && !!onSelect;
  return (
    <div
      {...clickProps(alert, onSelect)}
      title={alert.text}
      className={cn(
        "alerts__card",
        `alerts__card--${severity}`,
        clickable && "alerts__card--clickable",
        active && "alerts__card--active"
      )}
    >
      <div className="alerts__card-top">
        <span className={cn("alerts__scope", isCamp && "alerts__scope--campaign")}>
          {isCamp ? "Campaign" : `LI ${alert.liId}`}
        </span>
        {alert.value != null && <span className="alerts__card-value">{alert.value}</span>}
      </div>
      <div className="alerts__card-label">{alert.label}</div>
    </div>
  );
}

function WarnPill({ alert, active, onSelect }: { alert: PacingAlertV1 } & SelectProps) {
  const isCamp = !alert.liId;
  const clickable = !isCamp && !!onSelect;
  return (
    <span
      {...clickProps(alert, onSelect)}
      title={alert.text}
      className={cn("alerts__pill", clickable && "alerts__pill--clickable", active && "alerts__pill--active")}
    >
      <span className={cn("alerts__pill-scope", isCamp && "alerts__scope--campaign")}>
        {isCamp ? "Camp" : `LI ${alert.liId}`}
      </span>
      {alert.value != null && <span className="alerts__pill-value">{alert.value}</span>}
      <span className="alerts__pill-label">{alert.label}</span>
    </span>
  );
}

export function AlertsBlock({
  alerts,
  selection = [],
  onSelect,
}: {
  alerts: readonly PacingAlertV1[];
  /** The page's line-item selection (`filters.selection`), to mark the alert that set it. */
  selection?: readonly string[];
  /** Called with a line item's id when its alert is clicked. */
  onSelect?: (liId: string) => void;
}) {
  const [warnExpanded, setWarnExpanded] = useState(false);
  if (!alerts.length) return null;

  const critical = alerts.filter((a) => a.severity === "critical");
  const warning = alerts.filter((a) => a.severity !== "critical");

  // Flip: when nothing is critical, the warnings take the cards.
  const cardSeverity: CardSeverity = critical.length > 0 ? "critical" : "warning";
  const cardAlerts = critical.length > 0 ? critical : warning;
  const lineAlerts = critical.length > 0 ? warning : [];

  const isActive = (a: PacingAlertV1) => !!a.liId && selection.length === 1 && selection[0] === a.liId;

  const overflow = lineAlerts.length > WARNING_VISIBLE;
  const visibleLine = warnExpanded ? lineAlerts : lineAlerts.slice(0, WARNING_VISIBLE);

  return (
    <div className="alerts">
      {/* The reference's AlertsTile titles the block; here the block carries it, so the board and
          Layout mode's registry both get it. */}
      <div className="alerts__title">Alerts</div>
      <GroupHead severity={cardSeverity} count={cardAlerts.length} />
      <div className={cn("alerts__cards", lineAlerts.length > 0 && "alerts__cards--above-line")}>
        {cardAlerts.map((a, i) => (
          <AlertCard key={alertKey(a, i)} alert={a} severity={cardSeverity} active={isActive(a)} onSelect={onSelect} />
        ))}
      </div>

      {lineAlerts.length > 0 && (
        <>
          <GroupHead severity="warning" count={lineAlerts.length} />
          <div className="alerts__line">
            {visibleLine.map((a, i) => (
              <WarnPill key={alertKey(a, i)} alert={a} active={isActive(a)} onSelect={onSelect} />
            ))}
            {overflow && (
              <button type="button" className="alerts__more" onClick={() => setWarnExpanded((x) => !x)}>
                {warnExpanded ? "Collapse ↑" : `+ ${lineAlerts.length - WARNING_VISIBLE} more ↓`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
