import { brickHighlightResult, createBrickHighlightReader } from '../widget-highlights.js';
// workspace/src/pages/Dashboard/components/Widgets/brick-registry.jsx
//
// Brick type → renderer (widget-library spec §7). One closed, own-key-checked map, so a
// `type` out of config_json can never reach a prototype method, and so "which types can
// this build draw?" has one answer that tests/dashboard/composite-render.test.js reads.
//
// There is no escape hatch here. Nothing in this file mounts a whole legacy section or
// a ready-card body — the owner's decision was full decomposition, and this map is
// where that would have leaked in. Every renderer takes ({brick, ctx}), asks
// brick-data.js for its number or its series, formats through fmtKpi, and hands the
// result to a kit component. They live here rather than in CustomComposite so that file
// stays about ARRANGEMENT.
//
// Two things every renderer shares:
//   · a null value is drawn as an em dash, never as 0 — a zero reads as measured
//     delivery, and half these tiles exist to say whether delivery happened;
//   · anything that needs a REFERENCE to mean something (a meter, a gauge, a delta
//     chip) draws NOTHING without one, instead of a bar anchored to nowhere.
import {
  BigStat, BulletMeter, StatusPill, DeltaChip, StatRow, VerdictHeader, ProgressBar,
  FlightBullet, MiniChart, DetailCard, UnitBar, DeviationGauge, MoneyStat,
  KvRow, NoteLine, RateRows,
} from '../ui/index.js';
import { fmtKpi } from './widget-format.js';
import { fI } from '../format.js';
import {
  brickValue, cellValue, deltaOf, deliveryUnits, rateTypeRows, canonicalNote, marginTone,
  detailSource, flightProgress, verdictOf, miniSeries, badgeWords,
} from '../brick-data.js';
// The gross twin of a client money aggregate (net cost mode, spec §7). A MoneyStat's
// number comes from the widget engine rather than campM, so its gross figure has to be
// summed over the same LIs and the same window — which is what grossAgg does.
import { grossAgg } from '../widget-data.js';
// The basis a money caption states, when gross and net are both dollars (spec §7), and
// the ONE rule that says which basis a binding's number is on.
import { basisLabel, basisForBind } from '../coef-rebuild.js';
// …and the one predicate that says whether the pair is actually on screen, so the
// caption and the figure below it are answered by the same rule (MoneyValue's own).
import { showsGrossPair } from '../dual-money.js';
// The word bands and meter scale come from the canonical Widget status module, so
// one delta can never be called two things on one screen.
import { paceStatus, marginStatus, marginWord, meterBounds } from '../widget-status.js';

/**
 * The status a brick paints itself with. The COLUMN's signal wins where there is one: a
 * framed card whose badge says "Behind plan" has already read the campaign, and its
 * headline number is that same reading — which is exactly how the ready cards are
 * written (their badge and their big number are one `paceStatus` call apart, on one
 * delta). Reading the headline's own value-against-target instead would colour the
 * Budget card by "84% of plan-to-date vs 100", a much harsher number than the pace it
 * is judged on. Outside a framed column a brick judges itself, which is what the hero's
 * margin signal needs.
 */
function toneOf(out, ctx) {
  if (ctx && ctx.status) return ctx.status;
  const d = deltaOf(out);
  return d == null ? undefined : paceStatus(d);
}

/** A signed figure in its own format — "+2.0 pp", "−$1,204.00". */
function signed(n, format) {
  if (n == null) return '—';
  if (format === 'percent' || format === 'percent2') {
    const digits = format === 'percent2' ? 2 : 1;
    return `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    })} pp`;
  }
  if (format === 'pp') return fmtKpi(n, format);
  return (n >= 0 ? '+' : '−') + fmtKpi(Math.abs(n), format);
}

function unsigned(n, format) {
  const value = fmtKpi(Math.abs(n), format);
  return value.startsWith('+') ? value.slice(1) : value;
}

function gaugeSpreadLabel(spread, format) {
  return ['percent', 'percent2', 'pp'].includes(format) ? `${spread} pp` : unsigned(spread, format);
}

/**
 * The caption a BOUND brick or cell prints (net cost mode, spec §7). These bricks draw ONE
 * number with no gross twin under it, so on a net pacing the label is the only thing that
 * says which basis that number is on — client money is net, and so is a margin. Which of
 * the two (or neither) is `basisForBind`'s answer, the very rule the report's auto captions
 * read, so «Margin Target» can never be captioned one way on a tile and another in a report.
 *
 * A binding with no client basis — media money, units, counts, percentages — answers null
 * and the author's label comes back untouched. That, plus the `netMode` gate inside
 * `basisLabel`, is why a pacing without the switch renders byte-identical.
 */
function boundLabel(label, bind, ctx) {
  const kind = basisForBind(bind);
  return kind ? basisLabel(label, kind, !!ctx?.netMode) : label;
}

function BigStatBrick({ brick, ctx }) {
  const v = brickValue(brick, ctx);
  // Two different things, and they do NOT go in the same place. A `label` is the
  // author's NAME for this number ("Our Cost Plan") and sits above it, like every other
  // labelled figure in a finance card. The metric's `sub` is a caption that finishes
  // the sentence the number starts ("84%" · "of plan-to-date") and sits beside it. A
  // stat measured against a target carries neither: the bricks under it say what it is
  // measured against.
  return (
    <BigStat
      label={boundLabel(brick.label, brick.bind, ctx)}
      value={fmtKpi(v.value, v.format)}
      caption={brick.target ? null : v.sub}
      status={toneOf(v, ctx)}
      highlight={brickHighlightResult(brick, ctx, v)}
    />
  );
}

function MeterBrick({ brick, ctx }) {
  const v = brickValue(brick, ctx);
  if (v.value == null || !(v.target > 0)) return null;
  // A FIXED scale anchored on the target ([target−20, target+10]), so the track never
  // moves with the value — the same bounds the ready card uses.
  const { min, max } = meterBounds(v.target, v.format);
  return (
    <BulletMeter
      value={v.value} target={v.target} min={min} max={max} invert={v.invert}
      highlight={brickHighlightResult(brick, ctx, v)}
      minLabel={v.format === 'percent' ? undefined : fmtKpi(min, v.format)}
      maxLabel={v.format === 'percent' ? undefined : fmtKpi(max, v.format)}
      valueLabel={ctx.compact ? undefined : `fact ${fmtKpi(v.value, v.format)}`}
      targetLabel={ctx.compact ? undefined : `target ${fmtKpi(v.target, v.format)}`}
    />
  );
}

function PillBrick({ brick, ctx }) {
  // A literal word (the operational badge) — it takes the column's signal, because the
  // words are the author's and the colour is the campaign's.
  if (brick.bind == null) {
    return brick.text ? <StatusPill text={brick.text} status={(ctx && ctx.status) || 'n'} highlight={brickHighlightResult(brick, ctx, { value: null })} /> : null;
  }
  const v = brickValue(brick, ctx);
  const d = deltaOf(v);
  if (brick.variant === 'delta') {
    if (v.value == null || v.target == null) return null;
    // The chip PRINTS the plain difference and is TONED by the inverted one: on a cost
    // metric, under is the good news. "vs target" always — a chip is three words wide,
    // and the thing it is measured against is named by the brick above it.
    return <DeltaChip text={`${signed(v.value - v.target, v.format)} vs target`} tone={d >= 0 ? 'g' : 'b'} highlight={brickHighlightResult(brick, ctx, v)} />;
  }
  if (d == null) {
    return v.value == null ? null : <StatusPill text={fmtKpi(v.value, v.format)} status={(ctx && ctx.status) || 'n'} highlight={brickHighlightResult(brick, ctx, v)} />;
  }
  // Target words ("Above target" … "Below target"), which is what the hero's margin
  // badge says. Pace words belong to the things that have a pace — the unit bars and
  // the column badges — and they read wrong on anything else.
  return <StatusPill text={marginWord(d)} status={marginStatus(d)} highlight={brickHighlightResult(brick, ctx, v)} />;
}

function StatRowBrick({ brick, ctx }) {
  const cells = [];
  for (const c of brick.cells || []) {
    const o = cellValue(c, ctx);
    // A cell naming a unit this campaign does not run is DROPPED, not em-dashed: the
    // row states all three delivery units and the campaign answers for the ones it has.
    if (o.absent) continue;
    // Net cost mode (spec §7): a statRow cell prints a single number and no gross twin,
    // so a client-money cell on a net pacing is showing the NET figure — and it sits in
    // the same card as figures captioned «(gross)». Without the word it reads as gross.
    // A margin cell («Margin Target», bound to `mTgt`) is net for the other reason.
    cells.push({ label: boundLabel(c.label, c.bind, ctx), value: fmtKpi(o.value, o.format), highlight: brickHighlightResult(c, ctx, o) });
  }
  if (!cells.length) return null;
  return <StatRow cells={cells} layout={brick.layout === 'pair' ? 'pair' : 'flex'} />;
}

function HeaderBrick({ brick, ctx }) {
  if (brick.content === 'text') return <VerdictHeader word={brick.label} status="n" reason={brick.sub} highlight={brickHighlightResult(brick, ctx, { value: null })} />;
  const v = verdictOf(ctx);
  if (!v) return <VerdictHeader word={brick.label} status="n" reason={brick.sub} highlight={brickHighlightResult(brick, ctx, { value: null })} />;
  // The author's `sub`, when there is one, replaces the computed reason: the verdict
  // word is the campaign's, the explanation may be the author's.
  return <VerdictHeader word={v.word} status={v.status} reason={Object.prototype.hasOwnProperty.call(brick, 'sub') ? brick.sub : v.reason} highlight={brickHighlightResult(brick, ctx, { value: null })} />;
}

function MiniChartBrick({ brick, ctx }) {
  const read = createBrickHighlightReader(ctx);
  const series = miniSeries(brick, ctx, true).map((series) => {
    const owner = (brick.series || []).find((item) => item.id === series.id);
    if (!owner?.highlights?.length) return series;
    return { ...series, highlights: series.values.map((value, index) => brickHighlightResult(owner, ctx, { value }, {
      formulaContext: 'date', date: series.dates[index], index, dates: series.dates,
      readFormula: (expr) => read(expr, { formulaContext: 'date', date: series.dates[index], index }),
    })) };
  });
  return <MiniChart series={series} label={brick.label} height={ctx.compact ? 28 : 44} />;
}

function DetailCardBrick({ brick, ctx }) {
  if (brick.source) {
    const d = detailSource(brick.source, ctx, !!brick.highlights?.length);
    const readFormula = createBrickHighlightReader(ctx);
    if (brick.highlights?.length) d.lines = d.lines.map((line) => ({ ...line, highlight: brickHighlightResult(brick, ctx, { value: line.muted ? null : line.numeric, target: line.target }, { readFormula, unit: line.unit }) }));
    return <DetailCard label={brick.label} lines={d.lines} sub={Object.prototype.hasOwnProperty.call(brick, 'sub') ? brick.sub : d.sub} status={d.status} />;
  }
  const v = brickValue(brick, ctx);
  return <DetailCard label={brick.label} lines={[{ value: fmtKpi(v.value, v.format) }]} sub={brick.sub} highlight={brickHighlightResult(brick, ctx, v)} />;
}

function UnitBarsBrick({ brick, ctx }) {
  const units = deliveryUnits(ctx.cm, brick.units);
  if (!units.length) return null;
  const readFormula = createBrickHighlightReader(ctx);
  return (
    <>
      {units.map((u) => {
        // A bar needs a plan in THIS window. A unit whose window holds none of its plan
        // (`noWindowPlan`) draws the no-plan row, and a highlight rule reads no plan or
        // marker for it, exactly as for a unit with no plan at all.
        const barred = u.hasPlan && !u.noWindowPlan;
        return (
          <UnitBar
            key={u.unit} unit={u.unit} hasPlan={barred} actualLabel={`${fI(u.actual)} actual`}
            noPlanText={u.noWindowPlan ? 'no plan in this window' : undefined}
            actualPct={u.actualPct} plannedPct={u.plannedPct} paceDelta={u.paceDelta}
            opText={u.opText} status={u.status}
            highlight={brickHighlightResult(brick, ctx, { value: u.actual, target: barred ? u.plan : null }, { marker: barred ? u.expected : null, readFormula, unit: u.unit })}
          />
        );
      })}
    </>
  );
}

function GaugeBrick({ brick, ctx }) {
  const v = brickValue(brick, ctx);
  const d = deltaOf(v);
  const gaugeSpread = Number.isFinite(brick.spread) && brick.spread > 0 ? brick.spread : 10;
  const spread = gaugeSpreadLabel(gaugeSpread, v.format);
  return <DeviationGauge value={v.value} target={v.target} spread={gaugeSpread}
    minLabel={`−${spread}`} maxLabel={`+${spread}`}
    status={d == null ? 'g' : paceStatus(d)} highlight={brickHighlightResult(brick, ctx, v)} />;
}

function comparisonOf(brick, value) {
  if (!brick.target || value.value == null || value.target == null) return null;
  return { value: value.value - value.target, good: deltaOf(value) >= 0, format: value.format, text: `${signed(value.value - value.target, value.format)} vs target` };
}

function MoneyStatBrick({ brick, ctx }) {
  const v = brickValue(brick, ctx);
  // Client blocks only, and only for a `budget` / `dc` formula bind — the pair the
  // constructor offers as Client budget / Client cost, and the v1 boundary the spec
  // draws (§7). grossAgg answers null for anything else, so a moneyStat bound to a
  // canonical campM rate keeps today's single value.
  //
  // A formula bind ONLY: `bindValue` reads a bind's `reading` and its `metric` before it
  // ever looks at `expr`, so a bind carrying both would put a gross twin summed from the
  // formula under a canonical number. grossAgg must answer for the figure on screen.
  const exprOnly = !!(brick.bind?.expr && brick.bind.metric == null && brick.bind.reading == null);
  const gross = (brick.role === 'client' && exprOnly && ctx.data?.sources)
    ? grossAgg(brick.bind.expr, ctx.data.range, ctx.data.sources) : null;
  // The caption carries the basis wherever the pair is DRAWN — gross leads, net rides
  // underneath, and both are dollars, so only the word tells them apart (§7).
  // `showsGrossPair` is the very predicate MoneyValue draws on, asked here so the caption
  // and the figure can never disagree (fix round 1). Note grossAgg answers a number for
  // every `budget`/`dc` client bind, net pacing or not — `gross != null` is NOT the pair.
  //
  // Where the pair is NOT drawn, a client money figure on a net pacing is still the NET
  // one, and it sits beside figures captioned «(gross)» — the prorated "Budget Plan"
  // headline is the case that made this visible, it said nothing at all. So it says net.
  const pair = showsGrossPair({ usd: v.value, role: brick.role, gross });
  const label = pair
    ? basisLabel(brick.label, 'client', true)
    : basisLabel(brick.label, 'net', brick.role === 'client' && !!ctx?.netMode);
  return <MoneyStat label={label} value={v.value} gross={gross} currency={ctx.currency} rate={ctx.rate} role={brick.role} comparison={comparisonOf(brick, v)} highlight={brickHighlightResult(brick, ctx, v)} />;
}

function KvRowBrick({ brick, ctx }) {
  const v = brickValue(brick, ctx);
  // ABSENT is not "—": a unit with no goal, or a daily rate on a flight that has ended,
  // is a row the ready cards and the to-plan zone did not draw at all. A null with no
  // reason still prints an em dash — that one IS a number the tile expected and did not
  // get.
  if (v.absent) return null;
  // Net cost mode (spec §7), same rule as the statRow cell: one number, no gross twin,
  // so a client-money or margin row on a net pacing names the basis it is printing.
  const label = boundLabel(brick.label, brick.bind, ctx);
  return <KvRow label={label} value={fmtKpi(v.value, v.format)} sub={brick.sub} emphasis={brick.emphasis} comparison={comparisonOf(brick, v)} highlight={brickHighlightResult(brick, ctx, v)} />;
}

function RateRowsBrick({ brick, ctx }) {
  const rows = rateTypeRows(ctx.cm, ctx.flCM, brick.series, { coefMode: ctx.coefMode, netMode: ctx.netMode, units: brick.units, highlightReadings: !!brick.highlights?.length, primaryCvOperative: !!ctx.primaryCvOperative });
  const readFormula = createBrickHighlightReader(ctx);
  const marked = brick.highlights?.length ? rows.map((row) => {
    if (row.kind === 'note') return row;
    if (row.kind === 'pair') return { ...row,
      left: { ...row.left, highlight: brickHighlightResult(brick, ctx, { value: row.left.numeric }, { readFormula, readingKind: 'plan', unit: row.unit }) },
      right: { ...row.right, highlight: brickHighlightResult(brick, ctx, { value: row.right.numeric, target: row.right.target }, { readFormula, unit: row.unit }) },
    };
    return { ...row, highlight: brickHighlightResult(brick, ctx, { value: row.usd ?? row.numeric }, { readFormula }) };
  }) : rows;
  return (
    <RateRows
      rows={marked}
      currency={ctx.currency} rate={ctx.rate}
    />
  );
}

function ProgressBarBrick({ brick, ctx }) {
  const v = brickValue(brick, ctx);
  const tick = brick.tick ? brickValue({ bind: brick.tick }, ctx) : null;
  const hasTarget = v.target > 0;
  const hasTick = !!(tick && tick.value != null && hasTarget);
  // The MARK is where delivery should be by now, and the gap between the fill and the
  // mark IS the pace — the same arithmetic the ready cards do, in one place.
  const delta = hasTick ? ((v.value - tick.value) / v.target) * 100
    : (v.invert && hasTarget && v.value != null ? ((v.value - v.target) / v.target) * 100 : null);
  // The label names the marker («needed today · 1,234»), so no marker, no label. A bar with no
  // target to place it on — a window holding none of the plan — drew the bare words «needed
  // today» under an empty track (review 2026-09-23).
  return (
    <ProgressBar
      highlight={brickHighlightResult(brick, ctx, v, { marker: tick?.value ?? null })}
      tone={brick.tone}
      size={brick.size}
      pct={hasTarget && v.value != null ? (v.value / v.target) * 100 : 0}
      tickPct={hasTick ? (tick.value / v.target) * 100 : null}
      tickLabel={brick.tickLabel && hasTick ? `${brick.tickLabel} · ${fmtKpi(tick.value, tick.format)}` : null}
      status={delta == null ? ((ctx && ctx.status) || 'g') : paceStatus(v.invert ? -delta : delta)}
    />
  );
}

function FlightBulletBrick({ brick, ctx }) {
  const f = flightProgress(ctx.cm, ctx.flCM, ctx.effLIs);
  return <FlightBullet day={f.day} total={f.total} daysLeftText={f.daysLeftText} highlight={brickHighlightResult(brick, ctx, { value: f.day, target: f.total })} />;
}

function NoteBrick({ brick, ctx }) {
  if (brick.source) {
    const text = canonicalNote(brick.source, ctx.cm, ctx.flCM, ctx.effLIs, ctx.facts);
    // Only the margin delta states a deviation, and it is coloured for the same reason
    // the number above it is.
    const tone = brick.source === 'marginDelta' ? marginTone(ctx.cm, ctx.flCM, ctx.facts) : null;
    return <NoteLine text={text} align={brick.align} tone={tone} style={brick.style} highlight={brickHighlightResult(brick, ctx, { value: null })} />;
  }
  return <NoteLine text={brick.text} align={brick.align} style={brick.style} highlight={brickHighlightResult(brick, ctx, { value: null })} />;
}

const BRICKS = {
  __proto__: null,
  bigStat: BigStatBrick,
  meter: MeterBrick,
  pill: PillBrick,
  statRow: StatRowBrick,
  header: HeaderBrick,
  miniChart: MiniChartBrick,
  detailCard: DetailCardBrick,
  unitBars: UnitBarsBrick,
  gauge: GaugeBrick,
  moneyStat: MoneyStatBrick,
  kvRow: KvRowBrick,
  rateRows: RateRowsBrick,
  progressBar: ProgressBarBrick,
  flightBullet: FlightBulletBrick,
  note: NoteBrick,
};

/** Own-key checked: a `type` from config_json must not reach the prototype. */
export function brickRenderer(type) {
  return (typeof type === 'string' && Object.prototype.hasOwnProperty.call(BRICKS, type)) ? BRICKS[type] : null;
}

/**
 * A framed column's badge, as the element CardChrome draws. A
 * literal is a plain chip; a LIVE badge is a status pill whose word changes with
 * delivery — and the status it lands on is published to the column's bricks, so the
 * card's headline number is coloured by the same reading its badge states.
 * → { node, status } — null when the column carries no badge.
 */
export function columnBadge(badge, ctx) {
  if (!badge) return null;
  if (typeof badge === 'string') return { node: <span className="kit-card-badge">{badge}</span>, status: null };
  if (badge.words === 'currency') {
    // The condition is the CAMPAIGN's, not a number's: the badge states the words it
    // decorates and the renderer asks whether this pacing is converted.
    const text = ctx.converted ? `${badge.text} · Converted` : badge.text;
    return { node: <span className="kit-card-badge">{text}</span>, status: null };
  }
  // The bound value IS the delta the word bands read (the badge binds an expression
  // that computes one), so it goes to the bands as it stands.
  const w = badgeWords(badge.words, brickValue({ bind: badge.bind }, ctx).value);
  if (!w) return null;
  return { node: <StatusPill text={w.text} status={w.status} />, status: w.status };
}
