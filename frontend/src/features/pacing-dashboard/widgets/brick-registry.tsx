/**
 * Brick type -> renderer. Ported down from the retired SPA's `brick-registry.jsx` (see that file's
 * own doc comment for the reasoning this keeps: one closed, own-key-checked map, so a `type` out of
 * `config_json` can never reach a prototype method, and there is exactly one place that answers
 * "which brick types can this build draw" - all 15).
 *
 * A brick with nothing to show renders EITHER nothing (a statRow with every cell absent, a unitBars
 * brick with no plan) or its own quiet "No data"/em-dash text through `fmtKpi` - never a fabricated
 * value. A brick type this build cannot compute a REAL figure for at all (rate-type buying-rate
 * breakdown, a mini-chart with no resolvable source) renders `UnsupportedBrick` instead of nothing, so
 * a user who placed it sees why it's empty rather than a mysteriously blank tile - see
 * `campaign-metrics.ts`'s doc comment for the exact list.
 */
import {
  BigStat, BulletMeter, StatusPill, DeltaChip, StatRow, VerdictHeader, ProgressBar, FlightBullet,
  DetailCard, UnitBar, DeviationGauge, MoneyStat, KvRow, NoteLine, UnsupportedBrick,
} from "./brick-kit";
import { fmtKpi } from "./widget-format";
import { fmtInt, fmtMoney } from "../format";
import {
  badgeWords, brickValue, canonicalNote, cellValue, deliveryUnits, deltaOf, detailSource,
  flightProgress, marginTone, rateRows, resolveBindValue, verdictOf, type BrickCtx,
} from "./brick-data";
import { marginStatus, marginWord, meterBounds, paceStatus, type Tone } from "./widget-status";
import type { Brick } from "./widget-types";

function toneOf(v: { value: number | null; target: number | null }, ctx: BrickCtx): Tone | undefined {
  if (ctx.status) return ctx.status;
  const d = deltaOf(v);
  return d == null ? undefined : paceStatus(d);
}

function signed(n: number | null, format: string | undefined): string {
  if (n == null) return "No data";
  if (format === "pp") return fmtKpi(n, format);
  return (n >= 0 ? "+" : "−") + fmtKpi(Math.abs(n), format);
}

function BigStatBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  const v = brickValue(brick, ctx);
  return (
    <BigStat label={brick.label} value={fmtKpi(v.value, v.format)} caption={brick.target ? null : brick.sub} status={toneOf(v, ctx)} />
  );
}

function MeterBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  const v = brickValue(brick, ctx);
  if (v.value == null || !(v.target != null && v.target > 0)) return null;
  const { min, max } = meterBounds(v.target);
  return (
    <BulletMeter
      value={v.value}
      target={v.target}
      min={min}
      max={max}
      valueLabel={ctx.compact ? undefined : `fact ${fmtKpi(v.value, v.format)}`}
      targetLabel={ctx.compact ? undefined : `target ${fmtKpi(v.target, v.format)}`}
    />
  );
}

function PillBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  if (brick.bind == null) {
    return brick.text ? <StatusPill text={brick.text} status={ctx.status || "n"} /> : null;
  }
  const v = brickValue(brick, ctx);
  const d = deltaOf(v);
  if (brick.variant === "delta") {
    if (v.value == null || v.target == null) return null;
    return <DeltaChip text={`${signed(v.value - v.target, v.format)} vs target`} tone={d != null && d >= 0 ? "g" : "b"} />;
  }
  if (d == null) {
    return v.value == null ? null : <StatusPill text={fmtKpi(v.value, v.format)} status={ctx.status || "n"} />;
  }
  return <StatusPill text={marginWord(d)} status={marginStatus(d)} />;
}

function StatRowBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  const cells: Array<{ label: string; value: string }> = [];
  for (const c of brick.cells || []) {
    const o = cellValue(c, ctx);
    if (o.absent) continue;
    cells.push({ label: c.label, value: fmtKpi(o.value, o.format) });
  }
  if (!cells.length) return null;
  return <StatRow cells={cells} layout={brick.layout === "pair" ? "pair" : "flex"} />;
}

function HeaderBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  const v = verdictOf(ctx);
  if (!v) return <VerdictHeader word={brick.label || "Verdict"} status="n" reason={brick.sub} />;
  return <VerdictHeader word={v.word} status={v.status} reason={brick.sub || v.reason} />;
}

function MiniChartBrick({ brick }: { brick: Brick; ctx: BrickCtx }) {
  // No resolvable time series for an arbitrary `brick.series` key on this side (no mini-series
  // catalog is ported - see campaign-metrics.ts) - an honest placeholder, never a blank sparkline.
  return <UnsupportedBrick label={brick.label} message="Trend not available in this view." />;
}

function DetailCardBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  if (brick.source) {
    // Pacing formats these lines. A detail card reads "1,234,567 impr", and the
    // separators, the unit words and the em dash standing in for an absent figure
    // are all chosen by the same code that chose the number.
    const d = detailSource(brick.source, ctx);
    if (!d) return <DetailCard label={brick.label} lines={[]} sub={brick.sub} />;
    return <DetailCard label={brick.label} lines={d.lines} sub={d.sub || brick.sub} status={d.status} />;
  }
  const v = brickValue(brick, ctx);
  // A bound figure, not a named source: the binding carries a number and nothing else, so
  // there is no unit word and no explainer to print beside it.
  return <DetailCard label={brick.label} lines={[{ value: fmtKpi(v.value, v.format), unit: null, note: null }]} sub={brick.sub} />;
}

function UnitBarsBrick({ ctx }: { brick: Brick; ctx: BrickCtx }) {
  const units = deliveryUnits(ctx);
  if (!units.length) return null;
  return (
    <>
      {units.map((u) => (
        <UnitBar
          key={u.unit}
          unit={u.unit}
          hasPlan={u.hasPlan}
          actualLabel={`${fmtInt(u.actual)} actual`}
          actualPct={u.actualPct}
          plannedPct={u.plannedPct}
          paceDelta={u.paceDelta}
          opText={u.opText}
          status={u.status}
        />
      ))}
    </>
  );
}

function GaugeBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  const v = brickValue(brick, ctx);
  const d = deltaOf(v);
  return <DeviationGauge value={v.value} target={v.target} spread={brick.spread} status={d == null ? "g" : paceStatus(d)} />;
}

function MoneyStatBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  const v = brickValue(brick, ctx);
  // The campaign's own currency travels on the dashboard payload, not in the
  // metric bag: it describes the pacing, not a figure.
  const currency = ctx.currency ?? null;
  return (
    <MoneyStat
      label={brick.label}
      value={fmtKpi(v.value, v.format || "money")}
      note={currency && currency !== "USD" ? `${currency} - not FX-converted in this view` : null}
    />
  );
}

function KvRowBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  const v = brickValue(brick, ctx);
  return <KvRow label={brick.label} value={fmtKpi(v.value, v.format)} sub={brick.sub} emphasis={brick.emphasis} />;
}

/**
 * The per-rate-type repeat: Plan CPC/CPV, the Bid Plan / Bid Fact 2d pair with its delta,
 * Earned @ Plan CPM, the dynamic client rates.
 *
 * A mixed campaign runs two or three rate types, so the SHAPE of this brick changes with the
 * pacing - which is why the list is built by Pacing and repeated over here.
 *
 * This used to render "Rate breakdown not available in this view" on the stated grounds that the
 * figures needed a DSP model nobody had ported. They did not: `rateTypeRows` has always been in
 * the engine, and every number it returns comes from the same two bags the rest of this file
 * reads. The rows were missing because nothing asked for them.
 */
function RateRowsBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  const rows = rateRows(brick.series, ctx);
  // Empty is not an error: a CPM-only pacing has no Plan CPC row to print, and the series
  // deliberately skips the CPM entry the card already shows above the repeat.
  if (rows.length === 0) return null;
  return (
    <div className="wgt-raterows">
      {rows.map((row, i) => {
        if (row.kind === "pair") {
          return (
            <div className="wgt-raterows__pair" key={row.unit || i}>
              <StatRow
                layout="pair"
                cells={[
                  { label: row.left?.label ?? "", value: row.left?.value ?? "" },
                  { label: row.right?.label ?? "", value: row.right?.value ?? "" },
                ]}
              />
              {row.delta && <DeltaChip text={row.delta.text} tone={row.delta.good ? "g" : "b"} />}
            </div>
          );
        }
        if (row.kind === "money") {
          return (
            <KvRow
              key={row.label || i}
              label={row.label}
              value={fmtMoney(row.usd ?? null)}
            />
          );
        }
        return <KvRow key={row.label || i} label={row.label} value={row.value ?? ""} />;
      })}
    </div>
  );
}

function ProgressBarBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  const v = brickValue(brick, ctx);
  const tickValue = brick.tick ? resolveBindValue(brick.tick, ctx) : null;
  const hasTarget = v.target != null && v.target > 0;
  const hasTick = tickValue != null && hasTarget && v.value != null;
  const delta = hasTick ? ((v.value! - tickValue!) / v.target!) * 100 : null;
  return (
    <ProgressBar
      pct={hasTarget && v.value != null ? (v.value / v.target!) * 100 : 0}
      tickPct={hasTick ? (tickValue! / v.target!) * 100 : null}
      tickLabel={brick.tickLabel ? (hasTick ? `${brick.tickLabel} · ${fmtKpi(tickValue, brick.format)}` : brick.tickLabel) : null}
      status={delta == null ? ctx.status || "g" : paceStatus(delta)}
    />
  );
}

function FlightBulletBrick({ ctx }: { brick: Brick; ctx: BrickCtx }) {
  const f = flightProgress(ctx);
  if (!f) return null;
  return <FlightBullet day={f.day} total={f.total} daysLeftText={f.daysLeftText} />;
}

function NoteBrick({ brick, ctx }: { brick: Brick; ctx: BrickCtx }) {
  if (brick.source) {
    const text = canonicalNote(brick.source, ctx);
    const tone = brick.source === "marginDelta" ? marginTone(ctx) : undefined;
    return <NoteLine text={text ?? ""} align={brick.align} tone={tone ?? null} />;
  }
  return <NoteLine text={brick.text || ""} align={brick.align} />;
}

type BrickComponent = (props: { brick: Brick; ctx: BrickCtx }) => JSX.Element | null;

// `Object.create(null)`, not `{}` - a `type` string like "constructor" or "toString" out of
// `config_json` must never resolve to an Object.prototype method (matches the SPA's own
// `{ __proto__: null, ... }` map, spelled with the equivalent, cleanly-typed constructor).
const BRICKS: Record<string, BrickComponent> = Object.assign(Object.create(null), {
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
});

/** Own-key checked: a `type` from `config_json` must not reach the prototype (matches the SPA's own
 *  `brickRenderer` - see brick-registry.jsx:250-253). */
export function brickRenderer(type: unknown): BrickComponent | null {
  return typeof type === "string" && Object.prototype.hasOwnProperty.call(BRICKS, type) ? BRICKS[type] : null;
}

export const KNOWN_BRICK_TYPES: readonly string[] = Object.keys(BRICKS);

/** A framed column's badge (see `HERO_STANDARD_ROWS`'s Budget/Delivery/Margin cards) - a literal chip,
 *  or a live status pill whose word/tone is published to the column's bricks via `ctx.status` (mirrors
 *  the SPA's `columnBadge`). */
export function columnBadge(
  badge: unknown,
  ctx: BrickCtx
): { node: JSX.Element; status: Tone | null } | null {
  if (!badge) return null;
  if (typeof badge === "string") return { node: <span className="wgt-col__badge">{badge}</span>, status: null };
  const b = badge as { words?: string; text?: string; bind?: { metric?: string; expr?: string } };
  if (b.words === "currency") {
    return { node: <span className="wgt-col__badge">{b.text}</span>, status: null };
  }
  if (b.words && b.bind) {
    const w = badgeWords(b.words, ctx);
    if (!w) return null;
    return { node: <StatusPill text={w.text} status={w.status} />, status: w.status };
  }
  return null;
}
