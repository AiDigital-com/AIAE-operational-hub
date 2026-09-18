/**
 * A pacing's alerts, laid out so a hundred of them stay readable.
 *
 * This replaces printing `alert.text` in a list. That worked while a pacing had
 * three alerts and fell apart at a hundred and thirty-two: every line a full
 * sentence, ninety of them saying "-100.0pp severely under target" about a
 * different line item, and the one alert that actually needed attention sitting
 * somewhere in the middle of the wall.
 *
 * The shape here is the retired SPA's (AlertsBlock.jsx: "Critical → cards in a
 * tight grid, warning → compact pill line. When critical=0, warning rises to
 * cards."), and for its reasons:
 *
 *   - A card leads with the NUMBER, large, and carries the short label under it.
 *     Scanning twenty numbers is possible; scanning twenty sentences is not.
 *   - Warnings are pills, because a warning is something to notice, not read.
 *   - Only the first few are shown. The rest are behind one click, counted, so
 *     the page says "and 118 more" instead of printing them.
 *
 * `value` and `label` come from Pacing (its own `displayParts`), so the
 * per-detector formatting rules are not duplicated here. `text` is kept as the
 * title attribute — the whole sentence is still the right thing for one alert
 * under the cursor.
 */
import { useState } from "react";
import { cn } from "../../shared/style/cn";
import type { PacingAlertV1 } from "./types";
import "./alerts-block.css";

/** How many of a severity to show before collapsing the rest. Matches the SPA's
 *  WARNING_VISIBLE; the same cut-off reads well for cards too. */
const VISIBLE = 5;

function alertKey(alert: PacingAlertV1, index: number): string {
  return `${alert.type}-${alert.liId ?? "campaign"}-${index}`;
}

/** The line this alert is about: its id, and its description when there is one.
 *  Both, deliberately — two line items can share a description, and shown without
 *  the id they read as one row alerting twice. */
function subject(alert: PacingAlertV1): string | null {
  if (!alert.liId) return null;
  return alert.name ? `${alert.liId} · ${alert.name}` : `Line item ${alert.liId}`;
}

function AlertCard({ alert }: { alert: PacingAlertV1 }) {
  return (
    <li className={cn("alerts__card", `alerts__card--${alert.severity}`)} title={alert.text}>
      {/* The number is the headline. When a detector has none, the label takes its
          place at the same size rather than leaving a gap where a figure should be. */}
      <span className={cn("alerts__value", !alert.value && "alerts__value--none")}>
        {alert.value ?? alert.label}
      </span>
      {alert.value && <span className="alerts__label">{alert.label}</span>}
      {subject(alert) && <span className="alerts__subject">{subject(alert)}</span>}
    </li>
  );
}

function AlertPill({ alert }: { alert: PacingAlertV1 }) {
  return (
    <li className={cn("alerts__pill", `alerts__pill--${alert.severity}`)} title={alert.text}>
      {alert.value && <b className="alerts__pill-value">{alert.value}</b>}
      <span>{alert.label}</span>
      {subject(alert) && <span className="alerts__pill-subject">{subject(alert)}</span>}
    </li>
  );
}

function Section({
  alerts,
  asCards,
  title,
}: {
  alerts: PacingAlertV1[];
  asCards: boolean;
  title: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!alerts.length) return null;

  const shown = expanded ? alerts : alerts.slice(0, VISIBLE);
  const hidden = alerts.length - shown.length;

  return (
    <div className="alerts__section">
      <div className="alerts__section-head">
        <span className="alerts__section-title">{title}</span>
        <span className="alerts__section-count">{alerts.length}</span>
      </div>
      <ul className={asCards ? "alerts__cards" : "alerts__pills"}>
        {shown.map((alert, index) =>
          asCards ? (
            <AlertCard key={alertKey(alert, index)} alert={alert} />
          ) : (
            <AlertPill key={alertKey(alert, index)} alert={alert} />
          )
        )}
      </ul>
      {hidden > 0 && (
        <button type="button" className="alerts__more" onClick={() => setExpanded(true)}>
          and {hidden} more
        </button>
      )}
      {expanded && alerts.length > VISIBLE && (
        <button type="button" className="alerts__more" onClick={() => setExpanded(false)}>
          Show fewer
        </button>
      )}
    </div>
  );
}

export function AlertsBlock({ alerts }: { alerts: readonly PacingAlertV1[] }) {
  if (!alerts.length) return null;

  const critical = alerts.filter((a) => a.severity === "critical");
  const warning = alerts.filter((a) => a.severity === "warning");
  const info = alerts.filter((a) => a.severity === "info");

  return (
    <div className="alerts">
      <Section alerts={critical} asCards title="Critical" />
      {/* With nothing critical, warnings are the worst news there is and get the
          cards — the SPA's rule, and it keeps the block from looking empty on a
          pacing whose only problems are warnings. */}
      <Section alerts={warning} asCards={critical.length === 0} title="Warnings" />
      <Section alerts={info} asCards={false} title="Notes" />
    </div>
  );
}
