/**
 * Small presentational pieces the 15 brick renderers compose (`brick-registry.tsx`) - a Hub-styled
 * (plain CSS, BEM, no left-rail stripes) equivalent of the retired SPA's `components/kit`. Every
 * component here takes already-resolved values (numbers/strings/tones) and draws them; none of them
 * reach into `campaign-metrics.ts` or `brick-data.ts` themselves.
 */
import type { ReactNode } from "react";
import { cn } from "../../../shared/style/cn";
import { TONE_COLOR, type Tone } from "./widget-status";
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

export function DetailCard({
  label,
  lines,
  sub,
  status,
}: {
  label?: string | null;
  lines: Array<{ value: string }>;
  sub?: string | null;
  status?: Tone;
}) {
  return (
    <div className="wgt-detail">
      {label && <div className="wgt-detail__label">{label}</div>}
      {lines.map((line, i) => (
        <div key={i} className="wgt-detail__value" style={status ? { color: TONE_COLOR[status] } : undefined}>
          {line.value}
        </div>
      ))}
      {sub && <div className="wgt-detail__sub">{sub}</div>}
    </div>
  );
}

export function UnitBar({
  unit,
  actualLabel,
  actualPct,
  plannedPct,
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
  return (
    <div className="wgt-unitbar">
      <div className="wgt-unitbar__head">
        <span className="wgt-unitbar__unit">{unit}</span>
        <span className="wgt-unitbar__actual">{actualLabel}</span>
      </div>
      <div className="wgt-unitbar__track">
        <div className="wgt-unitbar__fill" style={{ width: `${Math.max(0, Math.min(100, actualPct))}%`, background: TONE_COLOR[status] }} />
        {plannedPct != null && <div className="wgt-unitbar__mark" style={{ left: `${Math.max(0, Math.min(100, plannedPct))}%` }} />}
      </div>
    </div>
  );
}

export function DeviationGauge({ value, target, status }: { value: number | null; target: number | null; spread?: number; status: Tone }) {
  if (value == null || target == null) return null;
  const delta = value - target;
  return (
    <div className="wgt-gauge">
      <span className="wgt-gauge__value" style={{ color: TONE_COLOR[status] }}>
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(1)}pp
      </span>
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
