/**
 * Small presentational pieces the 15 brick renderers compose (`brick-registry.tsx`) - a Hub-styled
 * (plain CSS, BEM, no left-rail stripes) equivalent of the retired SPA's `components/kit`. Every
 * component here takes already-resolved values (numbers/strings/tones) and draws them; none of them
 * reach into `campaign-metrics.ts` or `brick-data.ts` themselves.
 */
import type { ReactNode } from "react";
import { cn } from "../../../shared/style/cn";
import { TONE_COLOR, type Tone } from "./widget-status";
import type { DetailLine } from "../types-metrics";
import "./brick-kit.css";

export function BigStat({
  label,
  value,
  caption,
  status,
}: {
  label?: string | null;
  value: string;
  caption?: string | null;
  status?: Tone;
}) {
  return (
    <div className="wgt-bigstat">
      {label && <div className="wgt-bigstat__label">{label}</div>}
      <div className="wgt-bigstat__value" style={status ? { color: TONE_COLOR[status] } : undefined}>
        {value}
      </div>
      {caption && <div className="wgt-bigstat__caption">{caption}</div>}
    </div>
  );
}

export function BulletMeter({
  value,
  target,
  min,
  max,
  valueLabel,
  targetLabel,
}: {
  value: number;
  target: number;
  min: number;
  max: number;
  valueLabel?: string;
  targetLabel?: string;
}) {
  const span = Math.max(1, max - min);
  const pct = (n: number) => Math.max(0, Math.min(100, ((n - min) / span) * 100));
  return (
    <div className="wgt-meter">
      <div className="wgt-meter__track">
        <div className="wgt-meter__fill" style={{ width: `${pct(value)}%` }} />
        <div className="wgt-meter__target" style={{ left: `${pct(target)}%` }} />
      </div>
      {(valueLabel || targetLabel) && (
        <div className="wgt-meter__labels">
          {valueLabel && <span>{valueLabel}</span>}
          {targetLabel && <span>{targetLabel}</span>}
        </div>
      )}
    </div>
  );
}

export function StatusPill({ text, status }: { text: string; status: Tone }) {
  return (
    <span className="wgt-pill" style={{ background: `color-mix(in srgb, ${TONE_COLOR[status]} 14%, transparent)`, color: TONE_COLOR[status] }}>
      {text}
    </span>
  );
}

export function DeltaChip({ text, tone }: { text: string; tone: "g" | "b" }) {
  return (
    <span className="wgt-delta-chip" style={{ color: TONE_COLOR[tone] }}>
      {text}
    </span>
  );
}

export function StatRow({ cells, layout }: { cells: Array<{ label: string; value: string }>; layout: "pair" | "flex" }) {
  return (
    <div className={cn("wgt-statrow", layout === "pair" && "wgt-statrow--pair")}>
      {cells.map((cell) => (
        <div key={cell.label} className="wgt-statrow__cell">
          <div className="wgt-statrow__label">{cell.label}</div>
          <div className="wgt-statrow__value">{cell.value}</div>
        </div>
      ))}
    </div>
  );
}

export function VerdictHeader({ word, status, reason }: { word: string; status: Tone; reason?: string | null }) {
  return (
    <div className="wgt-verdict">
      <div className="wgt-verdict__word" style={{ color: TONE_COLOR[status] }}>
        {word}
      </div>
      {reason && <div className="wgt-verdict__reason">{reason}</div>}
    </div>
  );
}

export function ProgressBar({
  pct,
  tickPct,
  tickLabel,
  status,
}: {
  pct: number;
  tickPct: number | null;
  tickLabel: string | null;
  status: Tone;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="wgt-progress">
      <div className="wgt-progress__track">
        <div className="wgt-progress__fill" style={{ width: `${clamped}%`, background: TONE_COLOR[status] }} />
        {tickPct != null && <div className="wgt-progress__tick" style={{ left: `${Math.max(0, Math.min(100, tickPct))}%` }} />}
      </div>
      {tickLabel && <div className="wgt-progress__tick-label">{tickLabel}</div>}
    </div>
  );
}

export function FlightBullet({ day, total, daysLeftText }: { day: number; total: number; daysLeftText: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (day / total) * 100)) : 0;
  return (
    <div className="wgt-flight">
      <div className="wgt-flight__track">
        <div className="wgt-flight__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="wgt-flight__label">
        Day {day} of {total} · {daysLeftText}
      </div>
    </div>
  );
}

/**
 * One stacked figure card.
 *
 * A line is `{ value, unit, note, muted }` and all four are load-bearing: Pacing formats the
 * number, names its unit and writes the sentence that explains it, and dropping any of them
 * turns a reading into a bare number. "4,998,739" is not "4,998,739 impr", and "25,436/day"
 * without "2,289,249 impr ÷ 90 days." is a target with nothing behind it.
 *
 * `muted` is a line that is not a figure at all ("Clicks plan not set"). It must not wear the
 * figure's type or the card's status colour, or an absent plan reads as a delivered zero.
 */
export function DetailCard({
  label,
  lines,
  sub,
  status,
}: {
  label?: string | null;
  lines: DetailLine[];
  sub?: string | null;
  status?: Tone;
}) {
  // Lines that carry their own explainer need air between them; lines that do not read as one
  // stacked figure. Two gaps, one component - the retired kit made the same call.
  const spaced = lines.some((line) => line.note);
  return (
    <div className="wgt-detail">
      {label && <div className="wgt-detail__label">{label}</div>}
      <div className={cn("wgt-detail__lines", spaced && "wgt-detail__lines--notes")}>
        {lines.map((line, i) => (
          <div key={i}>
            <div
              className={cn("wgt-detail__value", line.muted && "wgt-detail__value--muted")}
              style={status && !line.muted ? { color: TONE_COLOR[status] } : undefined}
            >
              <span className="wgt-detail__number">{line.value}</span>
              {line.unit && <span className="wgt-detail__unit">{line.unit}</span>}
            </div>
            {line.note && <div className="wgt-detail__note">{line.note}</div>}
          </div>
        ))}
      </div>
      {sub && <div className="wgt-detail__sub">{sub}</div>}
    </div>
  );
}

const clampPct = (n: number | null | undefined) => Math.max(0, Math.min(100, n || 0));

/**
 * One delivery unit's row: the two percentages, the bar with its plan-pace tick, and the pace
 * line under it.
 *
 * The whole track is the flight (0 → 100% of plan), the fill is what actually delivered and
 * the tick marks where delivery should be by now. The gap between them IS the delta printed
 * underneath - so a bar drawn without that line shows the gap and refuses to name it, which is
 * what this component did while `paceDelta` and `opText` arrived and went unread.
 *
 * `hasPlan: false` is a unit with no goal at all. It gets its count and no bar: there is no
 * pace to be on or off, and a 0%-wide bar would read as one that is failing.
 */
export function UnitBar({
  unit,
  hasPlan,
  actualLabel,
  actualPct,
  plannedPct,
  paceDelta,
  opText,
  status,
}: {
  unit: string;
  hasPlan: boolean;
  actualLabel: string;
  actualPct: number;
  plannedPct: number | null;
  paceDelta: number | null;
  opText: string;
  status: Tone;
}) {
  if (!hasPlan) {
    return (
      <div className="wgt-unitbar">
        <div className="wgt-unitbar__head">
          <span className="wgt-unitbar__unit">{unit}</span>
          <span className="wgt-unitbar__actual">{actualLabel} · plan not set</span>
        </div>
      </div>
    );
  }
  const delta = paceDelta ?? 0;
  const sign = delta >= 0 ? "+" : "−";
  const direction = delta > 0.05 ? "ahead of plan" : delta < -0.05 ? "behind plan" : "on plan";
  const color = TONE_COLOR[status];
  return (
    <div className="wgt-unitbar">
      <div className="wgt-unitbar__head">
        <span className="wgt-unitbar__unit">{unit}</span>
        <span className="wgt-unitbar__pcts">
          Actual {actualPct.toFixed(1)}% <span className="wgt-unitbar__sep">/</span> Plan{" "}
          {(plannedPct ?? 0).toFixed(1)}%
        </span>
      </div>
      <div className="wgt-unitbar__track">
        <div className="wgt-unitbar__fill" style={{ width: `${clampPct(actualPct)}%`, background: color }} />
        {plannedPct != null && <div className="wgt-unitbar__mark" style={{ left: `${clampPct(plannedPct)}%` }} />}
      </div>
      <div className="wgt-unitbar__foot">
        <span className="wgt-unitbar__delta" style={{ color }}>
          {sign}
          {Math.abs(delta).toFixed(1)} pp
        </span>
        <span className="wgt-unitbar__dir">{direction} ·</span>
        <span className="wgt-unitbar__op" style={{ color }}>
          {opText}
        </span>
      </div>
    </div>
  );
}

/**
 * How far a figure sits from its target, on a corridor of `spread` points either side.
 *
 * The corridor is the reading: "+12.5 pp" alone says nothing about whether that is a lot.
 * `spread` arrives on the brick (the hero's margin gauge asks for 10) and was declared and
 * ignored here, which left the number floating with no scale to judge it by.
 */
export function DeviationGauge({ value, target, spread, status }: { value: number | null; target: number | null; spread?: number; status: Tone }) {
  if (value == null || target == null) return null;
  const delta = value - target;
  const range = Number.isFinite(spread) && (spread as number) > 0 ? (spread as number) : 10;
  // Where the delta lands on the corridor, 50% being dead on target. Clamped: a figure past
  // the corridor's end is off the scale, and a marker outside the track would say nothing
  // more than one pinned to its edge.
  const markerPct = Math.max(0, Math.min(100, ((delta + range) / (range * 2)) * 100));
  return (
    <div className="wgt-gauge">
      <span className="wgt-gauge__value" style={{ color: TONE_COLOR[status] }}>
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(1)}pp
      </span>
      <div className="wgt-gauge__scale">
        <span className="wgt-gauge__bound">−{range} pp</span>
        <span className="wgt-gauge__track">
          <span className="wgt-gauge__centre" />
          <span className="wgt-gauge__marker" style={{ left: `${markerPct}%`, background: TONE_COLOR[status] }} />
        </span>
        <span className="wgt-gauge__bound">+{range} pp</span>
      </div>
      <span className="wgt-gauge__sub">vs target</span>
    </div>
  );
}

export function MoneyStat({ label, value, note }: { label?: string | null; value: string; note?: string | null }) {
  return (
    <div className="wgt-money">
      {label && <div className="wgt-money__label">{label}</div>}
      <div className="wgt-money__value">{value}</div>
      {note && <div className="wgt-money__note">{note}</div>}
    </div>
  );
}

export function KvRow({
  label,
  value,
  sub,
  emphasis,
}: {
  label?: string | null;
  value: string;
  sub?: string | null;
  emphasis?: string | null;
}) {
  return (
    <div className={cn("wgt-kvrow", emphasis === "strong" && "wgt-kvrow--strong", emphasis === "muted" && "wgt-kvrow--muted")}>
      {label && <span className="wgt-kvrow__label">{label}</span>}
      <span className="wgt-kvrow__value">{value}</span>
      {sub && <span className="wgt-kvrow__sub">{sub}</span>}
    </div>
  );
}

export function NoteLine({ text, align, tone }: { text: string; align?: string; tone?: Tone | null }) {
  return (
    <div
      className={cn("wgt-note", align === "center" && "wgt-note--center", align === "end" && "wgt-note--end")}
      style={tone ? { color: TONE_COLOR[tone] } : undefined}
    >
      {text}
    </div>
  );
}

/** Not part of the reference kit: shown instead of a bare blank spot for a brick this build cannot
 *  compute a real value for (per-rate-type buying rates, mini-chart sparklines with no source, an
 *  unresolved widget kind) - see `brick-registry.tsx`'s degrade rule. */
export function UnsupportedBrick({ label, message }: { label?: string | null; message: string }) {
  return (
    <div className="wgt-unsupported">
      {label && <div className="wgt-unsupported__label">{label}</div>}
      <div className="wgt-unsupported__message">{message}</div>
    </div>
  );
}

export function BrickColumn({
  frame,
  title,
  sub,
  badge,
  children,
}: {
  frame?: string;
  title?: string | null;
  sub?: string | null;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn("wgt-col", frame === "card" && "wgt-col--card", frame === "signal" && "wgt-col--signal")}>
      {(title || badge) && (
        <div className="wgt-col__head">
          {title && <span className="wgt-col__title">{title}</span>}
          {badge}
        </div>
      )}
      {sub && <div className="wgt-col__sub">{sub}</div>}
      <div className="wgt-col__body">{children}</div>
    </div>
  );
}
