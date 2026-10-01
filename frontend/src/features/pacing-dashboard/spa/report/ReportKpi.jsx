import { highlightTextStyle, highlightTitle } from '../ui/highlight-style.js';
// workspace/src/pages/Dashboard/components/Widgets/Report/ReportKpi.jsx
//
// The v2 report's KPI view (widget-builder v2 spec 2026-08-19 §5.3; P2 plan Task 7).
// It draws `buildReportKpiModel`'s answer and decides nothing: the number, the target, the
// delta and whether that delta is good all arrive on `model`, and the only questions
// answered here are about looking at one number.
//
// PROPS ONLY, and deliberately no hooks — the same property ReportChart stands on: the
// tile, the layout preview and the gallery miniature all render this component, and a
// zustand hook inside it would answer with the store's INITIAL state on every surface that
// has no provider.
//
// The canonical KPI language is a mono `text-20` value, a signed mono delta with its
// "vs target" caption, and an amber ⚠ when the engine read something as 0. Every value
// prints through `fmtV2`, so a KPI and a Table View format the same metric identically.
//
// `currency` is accepted and prints nothing today, for the reason fmtV2 gives: every money
// value the engine produces is already USD. It stays in the signature so the five view
// renderers take one shape.
import { fmtV2 } from '../report-render.js';

/** §6's ⇄ marks what FOLLOWS the metric switch, and it is visible to the viewer, not only
 *  to the author — the same mark the chart's legend and the table's header carry. On a KPI
 *  the title is the only thing to hang it on, and a title is always authored: this is the
 *  one place the glyph rides text a person typed. */
const kpiName = (view, model) => {
  const title = (view && view.title) || '';
  return model.bound ? `${title} ⇄` : title;
};

/**
 * The Δ-vs-other-source reading (§5.3), in CompareTable's own shape: signed, one decimal,
 * with a real minus sign. `deltaPct` arrives already IN percent (the model does the ×100
 * beside the rule), and null when there was no delivery to divide by — which prints the
 * empty-cell placeholder, exactly as a zero-BQ Δ% cell does in the table.
 */
const fmtDeltaPct = (pct) => {
  if (pct == null) return '—';
  return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1).replace('-', '−')}%`;
};

/**
 * How far apart the two sources are, coloured by MAGNITUDE: CompareTable's own corridor
 * (|Δ| ≤10 green, ≤25 amber, beyond red), restated because that component's tint is a
 * full-cell background CLASS and this is a run of text. The two thresholds are pinned
 * against each other in tests/dashboard/report-widget.test.js, so neither corridor can move
 * alone.
 *
 * NOT the delta chip's sign colouring (controller ruling, 2026-08-21; the P2 plan's Task 9
 * wording said sign). A +21% CM360 overcount is exactly as wrong as a −21% undercount, and
 * this line and the compare view answer the SAME question about the same two sources — two
 * colour codes for one comparison on one screen is incoherent. The owner can re-flip at
 * acceptance: it is this one expression.
 */
const deltaCorridor = (pct) => {
  if (pct == null) return 'var(--text-muted)';
  const a = Math.abs(pct);
  if (a <= 10) return 'var(--status-green)';
  if (a <= 25) return 'var(--status-amber)';
  return 'var(--status-red)';
};

/** The two cell formats that print a `%`. `pp` is the third percent-family format and is
 *  deliberately not here: it already writes the unit a delta wants. */
const PERCENT_CELL_FORMATS = ['percent', 'percent2'];

/**
 * The delta, in the unit a DIFFERENCE is measured in.
 *
 * A KPI's fact keeps the format its author stored, and for a percent one that format prints
 * a `%`. The distance between two percentages is not a percentage though — it is points, and
 * `+0.02%` under a CTR of `0.14%` reads as «two hundredths of a percent above target» to
 * anyone who takes the sign at its word. The legacy Targets bar has printed `pp` there since
 * it was written (KpiPlanFact.jsx:16), and this is the same statement in v2's own vocabulary:
 * the magnitude is `fmtV2`'s, and only the unit at the end of it changes.
 *
 * `pp` itself is left alone — `fmtV2` already writes that unit — and so is every other
 * family: a difference of two prices IS a price, a difference of two counts is a count.
 */
const fmtDelta = (delta, format, currency) => {
  const magnitude = fmtV2(Math.abs(delta), format, currency).replace(/^[+−-]/, '');
  // The formatter may emit a sign of its own (a `pp` value always does), so the magnitude
  // is formatted first and the sign is written exactly once here.
  const sign = delta >= 0 ? '+' : '−';
  return sign + (PERCENT_CELL_FORMATS.includes(format) ? magnitude.replace(/%$/, ' pp') : magnitude);
};

/** The house badge, the widget frame's own (WidgetFrame.jsx): tiny barlow, uppercase,
 *  tinted plate, no border and no rail. §2's «full flight» tag is one of these. */
const BADGE = {
  fontFamily: 'var(--font-barlow)', fontWeight: 700, letterSpacing: '0.07em',
  textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--rxs)',
  background: 'var(--surface-tertiary)', color: 'var(--text-muted)',
};

/**
 * What colours the delta.
 *
 * The four states are `shared/kpi-band.js`'s, and the map is the legacy Targets band's own
 * (KpiPlanFact.jsx:23-28) so the two surfaces cannot paint one reading two ways. `status`
 * arrives only where the author named a corridor; without one this is the sign, which is what
 * every v2 KPI has always drawn — green above target, red below it, whatever the distance.
 */
const STATUS_COLOR = {
  g: 'var(--status-green)',
  w: 'var(--status-amber)',
  b: 'var(--status-red)',
  n: 'var(--text-muted)',
};
const deltaColor = (model) => (
  model.status ? STATUS_COLOR[model.status] : (model.good ? 'var(--status-green)' : 'var(--status-red)')
);

/** The line a cell draws where its verdict would be when the campaign carries no such goal.
 *  The legacy band keeps the slot and prints a muted «vs —»; this says the same in words, so
 *  the cells in a row keep one baseline and the reader is told WHY there is no verdict. */
const NO_TARGET = 'No target set';

/**
 * The rows UNDER the reading: the Δ-vs-CM360 line, the support line, a refused value and a
 * refused target. They are the same rows in both densities, so they live here once — the
 * band puts them in a padded strip of their own, the stacked cell already has one.
 *
 * NOTHING is drawn when there is nothing to say, and in the band that is the common case:
 * an empty strip still spends its 10px of bottom padding, which would make every cell in
 * the Targets row that much taller than the 44px line it exists to be.
 */
function KpiTail({ model, format, currency, band = false }) {
  const cm = model.deltaVsOtherSource && !model.deltaVsOtherSource.pendingCm;
  if (!cm && !model.support && !model.error && !model.targetError) return null;
  const rows = (
    <>
      {/* The support line (§5.3), its own row under the chip: same text size and the same
          mono NUMBER, with the words in the muted sans the chip's «vs» already uses, so
          the two rows read as one column of readings rather than a chip with a tail. Both
          are block rows in one column, so neither can move the other sideways, and the
          line appears and disappears without touching the value row above it. While
          `deltaVsOtherSource` still says `pendingCm` there is no CM360 number yet and
          nothing is drawn. The colour is deltaCorridor's — the compare view's corridor,
          not the chip's sign; the reason is up there with it. */}
      {cm && (
        <div className="text-11 mt-1">
          {/* The tip hangs off the TEXT, not off the row: a full-width `help` cursor over
              empty space to the right of a short reading is a hover target nobody aimed at. */}
          <span
            className="ui-tip"
            data-tip={`CM360 over this window: ${fmtV2(model.deltaVsOtherSource.cmValue, format, currency)}`}
            style={{ cursor: 'help' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>Δ vs CM360: </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              color: deltaCorridor(model.deltaVsOtherSource.deltaPct),
            }}>
              {fmtDeltaPct(model.deltaVsOtherSource.deltaPct)}
            </span>
          </span>
        </div>
      )}
      {model.support && (
        <div className="text-10 mt-1" style={{ color: 'var(--text-muted)' }}>{model.support}</div>
      )}
      {model.error && (
        <div className="text-10 mt-1" style={{ color: 'var(--text-muted)' }}>{model.error}</div>
      )}
      {/* The chip that is not there, explained (§5.3 + P2 handoff §5.4). Its own row under
          the value, in the same muted 10 the refusal above wears: the two are the same
          kind of statement about two different halves, and the sentence — «Target
          unavailable: …», the model's, prefix and all — is what tells them apart. It
          appears only when there IS a target that broke, so nothing moves on a tile whose
          author never asked for one. */}
      {model.targetError && (
        <div className="text-10 mt-1" style={{ color: 'var(--text-muted)' }}>{model.targetError}</div>
      )}
    </>
  );
  return band ? <div className="rpt-kpi-tail">{rows}</div> : rows;
}

export default function ReportKpi({ view, model, currency = null }) {
  if (!model) return null;
  const { value, format, target, delta, warned } = model;
  // A target with no number is CM-fed and the adapter has not answered yet: the model keeps
  // the slot so the number has somewhere to land, and there is no chip to draw until it does.
  const hasTarget = !!target && target.value != null && delta != null;
  // The legacy Targets strip's one-line cell (§5.3's `density`). Everything below is the same
  // content in the same order; only the box changes.
  const band = view && view.density === 'band';

  const number = (
    <span
      className={band ? 'rpt-kpi-bv' : 'text-20'}
      title={highlightTitle(model.highlight)}
      style={{ ...(band ? {} : {
        fontFamily: 'var(--font-mono)', fontWeight: 600,
        color: 'var(--text-primary)', letterSpacing: '-0.4px',
      }), ...highlightTextStyle(model.highlight) }}
    >
      {fmtV2(value, format, currency)}
    </span>
  );
  const marks = (
    <>
      {warned && (
        <span
          className="text-9 ui-tip"
          data-tip="Some inputs were empty or invalid and read as 0"
          style={{ color: 'var(--status-amber)', cursor: 'help', fontFamily: 'var(--font-sans)' }}
        >
          ⚠
        </span>
      )}
      {model.fullFlight && (
        <span
          className="text-9 ui-tip"
          data-tip="A campaign-level value: the period switch does not recompute it"
          style={{ ...BADGE, cursor: 'help' }}
        >
          full flight
        </span>
      )}
    </>
  );
  const verdict = hasTarget ? (
    <>
      <span style={{ color: deltaColor(model) }}>{fmtDelta(delta, format, currency)}</span>
      <span className={band ? 'rpt-kpi-vs' : 'ml-2'} style={{ color: 'var(--text-muted)' }}>
        vs {fmtV2(target.value, format, currency)}
      </span>
    </>
  ) : null;

  if (band) {
    return (
      <div className="rpt-view">
        {/* One row, one baseline, in the band's own order: the label in front of the number
            instead of over it, then the verdict and what it is measured against. The row
            WRAPS rather than crushing, so a narrow tile stacks the parts of one cell instead
            of clipping them. */}
        <div className="rpt-kpi-band">
          {view.title ? <span className="rpt-kpi-bl">{kpiName(view, model)}</span> : null}
          {number}
          {marks}
          {verdict && <span className="text-11 rpt-kpi-bd">{verdict}</span>}
          {/* The slot the band keeps: no verdict, and the reason, on the line the verdict
              would have used — so a row of cells shares one bottom edge either way. */}
          {model.targetAbsent && <span className="text-11 rpt-kpi-vs">{NO_TARGET}</span>}
        </div>
        <KpiTail model={model} format={format} currency={currency} band />
      </div>
    );
  }

  return (
    <div className="rpt-view">
      {view?.title ? (
        <div className="text-11 rpt-view-title" style={{ padding: '10px 12px 0', fontWeight: 600, color: 'var(--text-secondary)' }}>
          {kpiName(view, model)}
        </div>
      ) : null}
      <div style={{ padding: '2px 12px 10px' }}>
        {/* One row, one baseline: the number, the warning it carries and the tag that says
            the Period switch will not move it. The tag and the ⚠ appear and disappear with
            the value they annotate, and neither can shift the line they sit on — the row's
            height is the mono 20 they are aligned to. */}
        <div className="flex flex-wrap items-baseline gap-2">
          {number}
          {marks}
        </div>
        {/* Spacing uses the shared 4px Tailwind scale so KPI and Table Views keep one rhythm. */}
        {hasTarget && (
          <div className="text-11 mt-1" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {verdict}
          </div>
        )}
        {/* The same slot the band keeps, in the stacked cell: one muted line where the chip
            would be, so two cells side by side still end on one baseline. */}
        {model.targetAbsent && (
          <div className="text-11 mt-1" style={{ color: 'var(--text-muted)' }}>{NO_TARGET}</div>
        )}
        <KpiTail model={model} format={format} currency={currency} />
      </div>
    </div>
  );
}
