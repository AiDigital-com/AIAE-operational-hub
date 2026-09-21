/**
 * Containers and their splits (§10's display half, US-129).
 *
 * A container is one line item's plan cut into a named period. Under it sit two kinds
 * of child, and they are NOT alternatives: date splits say WHEN the container's units
 * land, sub-breakdowns say WHAT they are. A container can carry both, cutting the same
 * units along independent axes — which is why nothing here sums a date split against a
 * sub-breakdown, or one dimension against another.
 *
 * Every figure is read, never computed. Target, actual, remaining, needed-per-day and
 * margin all arrive in `metrics.containers`, worked out by Pacing's own engine
 * (shared/dashboard-metrics.js: childProgress, splitActualMargin) — the same functions
 * the retired SPA ran in the browser. A sub-breakdown's target in particular is already
 * resolved: a percent-mode one is a share of its parent's units, and re-deriving that
 * here would be the double-application bug the plan warns about.
 *
 * `marginActual` is null until something delivers. That is not 0% and must not render
 * as one: a container with no delivery has no realized margin, and showing 0% would
 * read as "we are losing everything".
 */
import { useState } from "react";
import { DIM_LABELS } from "../pacing-plan/containers";
import { fmtInt, fmtMoney, fmtPercent } from "./format";
import type { ContainerChildReading, ContainerReading, PacingMetricsBag, SplitMargin } from "./types-metrics";
import "./containers-table.css";

/** Pacing's own three-way verdict. Words, not just a colour — a tone alone is unreadable
 *  to anyone who cannot distinguish them, and unreadable in a printed copy. */
const MARGIN_WORD: Record<string, string> = { g: "On target", w: "Watch", b: "Below target" };

function MarginCell({ margin }: { margin: SplitMargin }) {
  if (!margin.hasMargin || margin.marginActual == null) {
    return <span className="pctn__muted" title="Nothing has delivered yet, so there is no realized margin">—</span>;
  }
  const status = margin.status ?? "g";
  return (
    <span className={`pctn__margin pctn__margin--${status}`}>
      {fmtPercent(margin.marginActual)}
      <span className="pctn__margin-target"> / {fmtPercent(margin.effM)}</span>
      <span className="pctn__sr">{MARGIN_WORD[status] ?? ""}</span>
    </span>
  );
}

/** Remaining units and what the days left would each have to carry. Reads "done" once
 *  the target is met, rather than showing a needed-per-day of 0 that looks like a stall. */
function PaceCell({ reading }: { reading: ContainerReading | ContainerChildReading }) {
  const { progress, target } = reading;
  if (!(target > 0)) return <span className="pctn__muted">no target</span>;
  if (progress.remaining <= 0) return <span className="pctn__pace pctn__pace--done">delivered</span>;
  if (progress.state === "ended") {
    return (
      <span className="pctn__pace pctn__pace--short">
        {fmtInt(progress.remaining)} short
      </span>
    );
  }
  if (progress.state === "not_started") return <span className="pctn__muted">not started</span>;
  return (
    <span className="pctn__pace">
      {fmtInt(Math.round(progress.neededPerDay))}/day
      <span className="pctn__pace-note"> · {progress.daysLeft}d left</span>
    </span>
  );
}

/**
 * How a child names itself.
 *
 * A sub-breakdown is re-labelled here rather than shown as Pacing sent it: the payload's
 * `label` carries the RAW dimension key ("audience: Sports fans"), while the plan editor
 * that authored it shows the human one ("Audience"). Two screens naming the same thing
 * two ways is the sort of small inconsistency that makes a reader doubt both. The key
 * is the stable identifier and stays the payload's; the word for it belongs to the
 * front end, which is where the rest of this feature's wording lives.
 *
 * An unknown key falls through to itself, so a dimension added on the Pacing side shows
 * up as its key rather than vanishing.
 */
function childLabel(child: ContainerChildReading): string {
  if (child.kind === "dim" && child.dimKey) {
    return `${DIM_LABELS[child.dimKey] ?? child.dimKey}: ${child.dimValue ?? ""}`;
  }
  return child.label || (child.fs && child.fe ? `${child.fs} – ${child.fe}` : "—");
}

function ChildRow({ child }: { child: ContainerChildReading }) {
  const pct = child.target > 0 ? (child.actual / child.target) * 100 : null;
  return (
    <tr className="pctn__row pctn__row--child">
      <td className="pctn__cell-name">
        <span className={`pctn__kind pctn__kind--${child.kind}`}>
          {child.kind === "dim" ? "split" : "period"}
        </span>
        <span className="pctn__child-label">
          {childLabel(child)}
        </span>
      </td>
      <td className="pctn__cell-num">{fmtInt(child.target)}</td>
      <td className="pctn__cell-num">{fmtInt(child.actual)}</td>
      <td className="pctn__cell-num">{pct == null ? "—" : fmtPercent(pct)}</td>
      <td className="pctn__cell-num">{fmtMoney(child.spend)}</td>
      <td className="pctn__cell-pace"><PaceCell reading={child} /></td>
      <td className="pctn__cell-margin"><MarginCell margin={child.margin} /></td>
    </tr>
  );
}

function ContainerBlock({ container }: { container: ContainerReading }) {
  const children = [...container.dateChildren, ...container.dimChildren];
  const [open, setOpen] = useState(children.length > 0);
  const pct = container.target > 0 ? (container.actual / container.target) * 100 : null;
  return (
    <>
      <tr className="pctn__row pctn__row--container">
        <td className="pctn__cell-name">
          {children.length > 0 ? (
            <button
              type="button"
              className="pctn__toggle"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              <span className={`pctn__chevron${open ? " pctn__chevron--open" : ""}`} aria-hidden="true">▸</span>
              <span className="pctn__container-name">{container.name || "Container"}</span>
            </button>
          ) : (
            <span className="pctn__container-name pctn__container-name--leaf">{container.name || "Container"}</span>
          )}
          {container.fs && container.fe && (
            <span className="pctn__period">{container.fs} – {container.fe}</span>
          )}
        </td>
        <td className="pctn__cell-num">{fmtInt(container.target)}</td>
        <td className="pctn__cell-num">{fmtInt(container.actual)}</td>
        <td className="pctn__cell-num">{pct == null ? "—" : fmtPercent(pct)}</td>
        <td className="pctn__cell-num">{fmtMoney(container.spend)}</td>
        <td className="pctn__cell-pace"><PaceCell reading={container} /></td>
        <td className="pctn__cell-margin"><MarginCell margin={container.margin} /></td>
      </tr>
      {open && children.map((c) => <ChildRow key={c.id ?? `${c.kind}-${c.label}`} child={c} />)}
    </>
  );
}

export function ContainersTable({ metrics }: { metrics: PacingMetricsBag | null }) {
  const byLineItem = metrics?.containers ?? {};
  const lineItemIds = Object.keys(byLineItem).filter((id) => byLineItem[id].length > 0).sort();
  // Nothing to say about a pacing planned at line-item level only. An empty table with
  // headings would read as "no delivery" rather than "nothing was split up".
  if (lineItemIds.length === 0) return null;

  return (
    <section className="pctn">
      <h3 className="pctn__title">Containers and splits</h3>
      <p className="pctn__lede">
        Each line item's plan cut into periods. Date splits say when the units land;
        sub-breakdowns say what they are — two independent cuts of the same units, so
        they are read against the container, never against each other.
      </p>
      {lineItemIds.map((id) => (
        <div key={id} className="pctn__li">
          <div className="pctn__li-head">LI {id}</div>
          <div className="pctn__scroll">
            <table className="pctn__table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" className="pctn__cell-num">Target</th>
                  <th scope="col" className="pctn__cell-num">Delivered</th>
                  <th scope="col" className="pctn__cell-num">%</th>
                  <th scope="col" className="pctn__cell-num">Spend</th>
                  <th scope="col">Pace</th>
                  <th scope="col">Margin / target</th>
                </tr>
              </thead>
              <tbody>
                {byLineItem[id].map((c) => <ContainerBlock key={c.id ?? c.name} container={c} />)}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
