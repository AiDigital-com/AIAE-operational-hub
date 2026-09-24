import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";
import { parseEditableNumber } from "../pacing-create/format";
import { cn } from "../../shared/style/cn";
import { formatError } from "../../shared/format/error";
import { useSavePacingNotifySettings } from "./hooks";
import type { SettingsSectionHandle, SettingsSectionProps } from "./settings-section";
import type { PacingAlertsConfigV1, PacingLineItemPlanV1, PacingNotifySettingsV1 } from "./types";
import "./alerts-panel.css";

/**
 * A pacing's alert configuration (§14 of the migration plan) - the retired SPA's Settings ·
 * Notifications tab (`NotificationsTab.jsx`), rebuilt on the Hub's own primitives.
 *
 * WHOLE-OBJECT SAVE, unlike every other section in this drawer. Pacing stores `notify` as one unit
 * and refuses a save that leaves out any of the 13 alert keys, so this panel always sends the
 * complete configuration back - never a patch of only the field the user touched. That is also why
 * `seed()` below fills in every key with its documented default rather than leaving anything
 * undefined: the object it produces is not just this panel's initial draft, it is the shape every
 * save from here on must keep.
 *
 * Threshold fields are edited as TEXT, not `number`, the same choice `pacing-plan`'s line-item editor
 * made (`EditableLineItem`): a controlled `<input type="number">` fights the user over an in-progress
 * "-" or a trailing ".", because neither parses to a value React can hold. A blank or unparseable
 * field falls back to what was last saved when Save is pressed - see `resolveNumber` below.
 */

const DEFAULT_ALERTS: PacingAlertsConfigV1 = {
  enabled: false,
  bidFactAbovePlan: { enabled: true, slack: true, window: 2, thresholdPct: 5 },
  dataGap: { enabled: true, slack: true, gapDays: 1 },
  ctrBelowTarget: { enabled: true, slack: true, factor: 0.7 },
  vcrBelowTarget: { enabled: true, slack: true, factor: 0.7 },
  ctrAboveTarget: { enabled: true, slack: true, factor: 2.0 },
  vcrOver100: { enabled: true, slack: true },
  noImpressionsYet: { enabled: true, slack: true },
  pacingOffPace: { enabled: true, slack: true, low: -5, high: 5 },
  marginBelowTarget: { enabled: true, slack: true, gapPp: 3 },
  spendOverspend: { enabled: true, slack: true, warnPct: 90, badPct: 100 },
  dspForecastOverspend: { enabled: true, slack: true },
  staleData: { enabled: true, slack: true, days: 2 },
  rateCostAbovePlan: { enabled: true, slack: true, thresholdPct: 10 },
};

/** Preserve an authored fractional percentage without binary-multiplication noise (0.7 * 100 must
 *  read "70", not "70.00000000000001"). */
function factorToPct(factor: number): number {
  return Number((factor * 100).toPrecision(12));
}

/**
 * A line item is video for this panel's purposes when its rate type is CPV, or it carries a VCR
 * target - the two signals `PacingLineItemPlanV1` actually exposes. Pacing's own detectors decide
 * "is this line item video" from delivered completes (`shared/alerts-core.js:isVideoLI`), which needs
 * daily facts this panel does not have reason to walk just to show or hide two rows; these two plan
 * fields are the closest proxy available from what the dashboard payload already carries.
 */
export function computeHasVideo(planByLineItem: Record<string, PacingLineItemPlanV1>): boolean {
  return Object.values(planByLineItem).some((li) => li.rateType === "CPV" || li.vcrTargetPct != null);
}

interface EditableBase { enabled: boolean; slack: boolean }
interface EditableWindowThreshold extends EditableBase { window: number; thresholdPct: string }
interface EditableGapDays extends EditableBase { gapDays: string }
interface EditableFactor extends EditableBase { factorPct: string }
interface EditableBand extends EditableBase { low: string; high: string }
interface EditableGapPp extends EditableBase { gapPp: string }
interface EditableSpend extends EditableBase { warnPct: string; badPct: string }
interface EditableDays extends EditableBase { days: string }
interface EditableThresholdPct extends EditableBase { thresholdPct: string }

interface EditableAlerts {
  enabled: boolean;
  bidFactAbovePlan: EditableWindowThreshold;
  dataGap: EditableGapDays;
  ctrBelowTarget: EditableFactor;
  vcrBelowTarget: EditableFactor;
  ctrAboveTarget: EditableFactor;
  vcrOver100: EditableBase;
  noImpressionsYet: EditableBase;
  pacingOffPace: EditableBand;
  marginBelowTarget: EditableGapPp;
  spendOverspend: EditableSpend;
  dspForecastOverspend: EditableBase;
  staleData: EditableDays;
  rateCostAbovePlan: EditableThresholdPct;
}

/** Every `EditableAlerts` key except the master `enabled` switch - i.e. the 13 keys whose value is
 *  itself a rule object sharing `EditableBase`. */
type AlertRuleKey = Exclude<keyof EditableAlerts, "enabled">;

interface EditableNotify {
  alerts: EditableAlerts;
  vcrMetric: boolean;
  hidePaused: boolean;
  /** `true` == `summary_projection: 'plan'`, `false` == `'reforecast'` (the default). */
  flatPlanInSummary: boolean;
}

/** Reads the stored configuration into this panel's editable draft, filling every key this pacing's
 *  `notify` does not carry (including a wholly absent `notify`, on a pacing nothing has ever
 *  configured) with the same default the detectors themselves fall back to. */
function seed(notify: PacingNotifySettingsV1 | undefined): EditableNotify {
  const a = notify?.alerts;
  const d = DEFAULT_ALERTS;
  return {
    alerts: {
      enabled: a?.enabled ?? d.enabled,
      bidFactAbovePlan: {
        enabled: a?.bidFactAbovePlan?.enabled ?? d.bidFactAbovePlan.enabled,
        slack: a?.bidFactAbovePlan?.slack ?? d.bidFactAbovePlan.slack,
        window: a?.bidFactAbovePlan?.window ?? d.bidFactAbovePlan.window,
        thresholdPct: String(a?.bidFactAbovePlan?.thresholdPct ?? d.bidFactAbovePlan.thresholdPct),
      },
      dataGap: {
        enabled: a?.dataGap?.enabled ?? d.dataGap.enabled,
        slack: a?.dataGap?.slack ?? d.dataGap.slack,
        gapDays: String(a?.dataGap?.gapDays ?? d.dataGap.gapDays),
      },
      ctrBelowTarget: {
        enabled: a?.ctrBelowTarget?.enabled ?? d.ctrBelowTarget.enabled,
        slack: a?.ctrBelowTarget?.slack ?? d.ctrBelowTarget.slack,
        factorPct: String(factorToPct(a?.ctrBelowTarget?.factor ?? d.ctrBelowTarget.factor)),
      },
      vcrBelowTarget: {
        enabled: a?.vcrBelowTarget?.enabled ?? d.vcrBelowTarget.enabled,
        slack: a?.vcrBelowTarget?.slack ?? d.vcrBelowTarget.slack,
        factorPct: String(factorToPct(a?.vcrBelowTarget?.factor ?? d.vcrBelowTarget.factor)),
      },
      ctrAboveTarget: {
        enabled: a?.ctrAboveTarget?.enabled ?? d.ctrAboveTarget.enabled,
        slack: a?.ctrAboveTarget?.slack ?? d.ctrAboveTarget.slack,
        factorPct: String(factorToPct(a?.ctrAboveTarget?.factor ?? d.ctrAboveTarget.factor)),
      },
      vcrOver100: {
        enabled: a?.vcrOver100?.enabled ?? d.vcrOver100.enabled,
        slack: a?.vcrOver100?.slack ?? d.vcrOver100.slack,
      },
      noImpressionsYet: {
        enabled: a?.noImpressionsYet?.enabled ?? d.noImpressionsYet.enabled,
        slack: a?.noImpressionsYet?.slack ?? d.noImpressionsYet.slack,
      },
      pacingOffPace: {
        enabled: a?.pacingOffPace?.enabled ?? d.pacingOffPace.enabled,
        slack: a?.pacingOffPace?.slack ?? d.pacingOffPace.slack,
        low: String(a?.pacingOffPace?.low ?? d.pacingOffPace.low),
        high: String(a?.pacingOffPace?.high ?? d.pacingOffPace.high),
      },
      marginBelowTarget: {
        enabled: a?.marginBelowTarget?.enabled ?? d.marginBelowTarget.enabled,
        slack: a?.marginBelowTarget?.slack ?? d.marginBelowTarget.slack,
        gapPp: String(a?.marginBelowTarget?.gapPp ?? d.marginBelowTarget.gapPp),
      },
      spendOverspend: {
        enabled: a?.spendOverspend?.enabled ?? d.spendOverspend.enabled,
        slack: a?.spendOverspend?.slack ?? d.spendOverspend.slack,
        warnPct: String(a?.spendOverspend?.warnPct ?? d.spendOverspend.warnPct),
        badPct: String(a?.spendOverspend?.badPct ?? d.spendOverspend.badPct),
      },
      dspForecastOverspend: {
        enabled: a?.dspForecastOverspend?.enabled ?? d.dspForecastOverspend.enabled,
        slack: a?.dspForecastOverspend?.slack ?? d.dspForecastOverspend.slack,
      },
      staleData: {
        enabled: a?.staleData?.enabled ?? d.staleData.enabled,
        slack: a?.staleData?.slack ?? d.staleData.slack,
        days: String(a?.staleData?.days ?? d.staleData.days),
      },
      rateCostAbovePlan: {
        enabled: a?.rateCostAbovePlan?.enabled ?? d.rateCostAbovePlan.enabled,
        slack: a?.rateCostAbovePlan?.slack ?? d.rateCostAbovePlan.slack,
        thresholdPct: String(a?.rateCostAbovePlan?.thresholdPct ?? d.rateCostAbovePlan.thresholdPct),
      },
    },
    vcrMetric: notify?.metrics?.vcr ?? false,
    hidePaused: notify?.hidePaused ?? false,
    flatPlanInSummary: notify?.summaryProjection === "plan",
  };
}

/** A blank/unparseable field falls back to `fallback` (the value last saved) rather than blocking
 *  Save or sending a value nobody typed. */
function resolveNumber(text: string, fallback: number): number {
  const n = parseEditableNumber(text);
  return n === undefined ? fallback : n;
}

/** Builds the whole `PacingNotifySettingsV1` this save must send, resolving every text field against
 *  the last-saved `base` so a field left blank mid-edit does not turn into a stray zero. */
function build(draft: EditableNotify, base: EditableNotify): PacingNotifySettingsV1 {
  const a = draft.alerts;
  const baseA = base.alerts;
  return {
    alerts: {
      enabled: a.enabled,
      bidFactAbovePlan: {
        enabled: a.bidFactAbovePlan.enabled,
        slack: a.bidFactAbovePlan.slack,
        window: a.bidFactAbovePlan.window,
        thresholdPct: resolveNumber(a.bidFactAbovePlan.thresholdPct, resolveNumber(baseA.bidFactAbovePlan.thresholdPct, DEFAULT_ALERTS.bidFactAbovePlan.thresholdPct)),
      },
      dataGap: {
        enabled: a.dataGap.enabled,
        slack: a.dataGap.slack,
        gapDays: resolveNumber(a.dataGap.gapDays, resolveNumber(baseA.dataGap.gapDays, DEFAULT_ALERTS.dataGap.gapDays)),
      },
      ctrBelowTarget: {
        enabled: a.ctrBelowTarget.enabled,
        slack: a.ctrBelowTarget.slack,
        factor: resolveNumber(a.ctrBelowTarget.factorPct, factorToPct(DEFAULT_ALERTS.ctrBelowTarget.factor)) / 100,
      },
      vcrBelowTarget: {
        enabled: a.vcrBelowTarget.enabled,
        slack: a.vcrBelowTarget.slack,
        factor: resolveNumber(a.vcrBelowTarget.factorPct, factorToPct(DEFAULT_ALERTS.vcrBelowTarget.factor)) / 100,
      },
      ctrAboveTarget: {
        enabled: a.ctrAboveTarget.enabled,
        slack: a.ctrAboveTarget.slack,
        factor: resolveNumber(a.ctrAboveTarget.factorPct, factorToPct(DEFAULT_ALERTS.ctrAboveTarget.factor)) / 100,
      },
      vcrOver100: { enabled: a.vcrOver100.enabled, slack: a.vcrOver100.slack },
      noImpressionsYet: { enabled: a.noImpressionsYet.enabled, slack: a.noImpressionsYet.slack },
      pacingOffPace: {
        enabled: a.pacingOffPace.enabled,
        slack: a.pacingOffPace.slack,
        low: resolveNumber(a.pacingOffPace.low, resolveNumber(baseA.pacingOffPace.low, DEFAULT_ALERTS.pacingOffPace.low)),
        high: resolveNumber(a.pacingOffPace.high, resolveNumber(baseA.pacingOffPace.high, DEFAULT_ALERTS.pacingOffPace.high)),
      },
      marginBelowTarget: {
        enabled: a.marginBelowTarget.enabled,
        slack: a.marginBelowTarget.slack,
        gapPp: resolveNumber(a.marginBelowTarget.gapPp, resolveNumber(baseA.marginBelowTarget.gapPp, DEFAULT_ALERTS.marginBelowTarget.gapPp)),
      },
      spendOverspend: {
        enabled: a.spendOverspend.enabled,
        slack: a.spendOverspend.slack,
        warnPct: resolveNumber(a.spendOverspend.warnPct, resolveNumber(baseA.spendOverspend.warnPct, DEFAULT_ALERTS.spendOverspend.warnPct)),
        badPct: resolveNumber(a.spendOverspend.badPct, resolveNumber(baseA.spendOverspend.badPct, DEFAULT_ALERTS.spendOverspend.badPct)),
      },
      dspForecastOverspend: { enabled: a.dspForecastOverspend.enabled, slack: a.dspForecastOverspend.slack },
      staleData: {
        enabled: a.staleData.enabled,
        slack: a.staleData.slack,
        days: resolveNumber(a.staleData.days, resolveNumber(baseA.staleData.days, DEFAULT_ALERTS.staleData.days)),
      },
      rateCostAbovePlan: {
        enabled: a.rateCostAbovePlan.enabled,
        slack: a.rateCostAbovePlan.slack,
        thresholdPct: resolveNumber(a.rateCostAbovePlan.thresholdPct, resolveNumber(baseA.rateCostAbovePlan.thresholdPct, DEFAULT_ALERTS.rateCostAbovePlan.thresholdPct)),
      },
    },
    metrics: { vcr: draft.vcrMetric },
    hidePaused: draft.hidePaused,
    summaryProjection: draft.flatPlanInSummary ? "plan" : "reforecast",
  };
}

function equal(a: EditableNotify, b: EditableNotify): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Row primitives ──────────────────────────────────────────────────────────

function NumField({
  value,
  step = 1,
  onChange,
  ariaLabel,
}: {
  value: string;
  step?: number;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      step={step}
      className="palerts__num"
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function SelectField({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: number;
  options: Array<{ value: number; label: string }>;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  return (
    <select
      className="palerts__select"
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

interface AlertRowProps {
  name: string;
  tag?: string;
  enabled: boolean;
  enabledMixed?: boolean;
  slack: boolean;
  slackMixed?: boolean;
  slackDisabled: boolean;
  onToggleEnabled: () => void;
  onToggleSlack: () => void;
  children?: ReactNode;
}

function AlertRow({
  name,
  tag,
  enabled,
  enabledMixed,
  slack,
  slackMixed,
  slackDisabled,
  onToggleEnabled,
  onToggleSlack,
  children,
}: AlertRowProps) {
  return (
    <div className={cn("palerts__row", !enabled && "palerts__row--off")}>
      <input
        type="checkbox"
        className="palerts__cb"
        checked={enabled}
        ref={(el) => { if (el) el.indeterminate = !!enabledMixed; }}
        onChange={onToggleEnabled}
        aria-label={`Enable ${name}`}
      />
      <div className="palerts__text">
        <span className="palerts__name">
          {name}
          {tag && <span className="palerts__tag">{tag}</span>}
        </span>
        {children && <span className="palerts__condition">{children}</span>}
      </div>
      <label
        className={cn("palerts__slack", slackDisabled && "palerts__slack--disabled")}
        title={
          slackDisabled
            ? "Enable Slack alerts and this rule to send it to Slack."
            : slack
              ? "Sent to Slack"
              : "Dashboard only"
        }
      >
        <input
          type="checkbox"
          className="palerts__cb"
          checked={slack}
          disabled={slackDisabled}
          ref={(el) => { if (el) el.indeterminate = !!slackMixed; }}
          onChange={onToggleSlack}
          aria-label={`Slack for ${name}`}
        />
        <span className="palerts__slack-text">Slack</span>
      </label>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export interface PacingAlertsSectionProps extends SettingsSectionProps {
  slug: string;
  /** This pacing's stored `notify` namespace, straight off the dashboard payload. Absent on a pacing
   *  nothing has ever configured - `seed()` reads that as every detector's own built-in default. */
  notify: PacingNotifySettingsV1 | undefined;
  /** Whether this pacing has a video line item (§14) - gates the two VCR-only rows. */
  hasVideo: boolean;
  /** Re-seeded whenever this changes - the drawer bumps it on open, so a reopened panel never shows
   *  an edit abandoned in a previous session. */
  seedKey: number;
}

export const PacingAlertsSection = forwardRef<SettingsSectionHandle, PacingAlertsSectionProps>(
  function PacingAlertsSection({ slug, notify, hasVideo, seedKey, onDirtyChange }, ref) {
    const [draft, setDraft] = useState<EditableNotify>(() => seed(notify));
    const [base, setBase] = useState<EditableNotify>(() => seed(notify));
    const save = useSavePacingNotifySettings(slug);

    // Re-hydrate from the latest server data on every open, never carrying a stale edit across a
    // close/reopen - the same rule the Data panel follows, and for the same reason: keyed on
    // `seedKey`/`slug`, not on `notify`, so a background refetch cannot clobber an edit in progress.
    useEffect(() => {
      const seeded = seed(notify);
      setDraft(seeded);
      setBase(seeded);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seedKey, slug]);

    const dirty = !equal(draft, base);
    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

    const draftRef = useRef(draft);
    draftRef.current = draft;
    const baseRef = useRef(base);
    baseRef.current = base;

    useImperativeHandle(ref, () => ({
      async save() {
        if (equal(draftRef.current, baseRef.current)) return { ok: true as const };
        try {
          await save.mutateAsync(build(draftRef.current, baseRef.current));
          setBase(draftRef.current);
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, message: formatError(error) };
        }
      },
      reset() {
        setDraft(base);
      },
    }));

    const masterOn = draft.alerts.enabled;

    function patchAlerts(patch: Partial<EditableAlerts>) {
      setDraft((prev) => ({ ...prev, alerts: { ...prev.alerts, ...patch } }));
    }
    // "enabled" (the master switch) excluded on purpose: every OTHER key of EditableAlerts is a rule
    // object sharing at least `EditableBase`'s {enabled, slack}, which is what makes both the field
    // patcher and the generic enable/Slack toggle below safe to write once for all thirteen.
    function patchKey<K extends AlertRuleKey>(key: K, patch: Partial<EditableAlerts[K]>) {
      setDraft((prev) => ({ ...prev, alerts: { ...prev.alerts, [key]: { ...prev.alerts[key], ...patch } } }));
    }
    function toggleRule(key: AlertRuleKey, field: "enabled" | "slack") {
      setDraft((prev) => {
        const rule = prev.alerts[key] as EditableBase;
        return { ...prev, alerts: { ...prev.alerts, [key]: { ...rule, [field]: !rule[field] } } };
      });
    }

    function rowProps(key: AlertRuleKey) {
      const rule = draft.alerts[key] as EditableBase;
      return {
        enabled: rule.enabled,
        slack: rule.slack,
        slackDisabled: !masterOn || !rule.enabled,
        onToggleEnabled: () => toggleRule(key, "enabled"),
        onToggleSlack: () => toggleRule(key, "slack"),
      };
    }

    // CTR vs target couples two keys under one row (canon's rule): the lower and upper bound share
    // enable/Slack, but each keeps its own value. Older saved configs can have just one side on - that
    // mixed state is shown (an indeterminate checkbox), never silently changed until the user acts.
    const ctrLow = draft.alerts.ctrBelowTarget;
    const ctrHigh = draft.alerts.ctrAboveTarget;
    const ctrCoupled = {
      enabled: ctrLow.enabled || ctrHigh.enabled,
      enabledMixed: ctrLow.enabled !== ctrHigh.enabled,
      slack: ctrLow.slack || ctrHigh.slack,
      slackMixed: ctrLow.slack !== ctrHigh.slack,
      slackDisabled: !masterOn || !(ctrLow.enabled || ctrHigh.enabled),
      onToggleEnabled: () => {
        const next = !(ctrLow.enabled && ctrHigh.enabled);
        patchAlerts({
          ctrBelowTarget: { ...ctrLow, enabled: next },
          ctrAboveTarget: { ...ctrHigh, enabled: next },
        });
      },
      onToggleSlack: () => {
        const next = !(ctrLow.slack && ctrHigh.slack);
        patchAlerts({
          ctrBelowTarget: { ...ctrLow, slack: next },
          ctrAboveTarget: { ...ctrHigh, slack: next },
        });
      },
    };

    const bidWindow = draft.alerts.bidFactAbovePlan.window || 2;

    return (
      <div className="palerts">
        <div className="palerts__globals">
          <label className="palerts__master">
            <input
              type="checkbox"
              checked={masterOn}
              aria-label="Send alerts to Slack"
              onChange={() => patchAlerts({ enabled: !masterOn })}
            />
            <span className="palerts__master-text">
              <span className="palerts__master-title">Send alerts to Slack</span>
              <span className="palerts__hint">When off, alerts stay on the dashboard.</span>
            </span>
          </label>

          <label className="palerts__master">
            <input
              type="checkbox"
              checked={draft.hidePaused}
              aria-label="Hide paused line items"
              onChange={() => setDraft((prev) => ({ ...prev, hidePaused: !prev.hidePaused }))}
            />
            <span className="palerts__master-text">
              <span className="palerts__master-title">Hide paused line items</span>
              <span className="palerts__hint">Exclude paused items from the Slack summary.</span>
            </span>
          </label>

          <label className="palerts__master">
            <input
              type="checkbox"
              checked={draft.flatPlanInSummary}
              aria-label="Use flat plan in Slack summary"
              onChange={() => setDraft((prev) => ({ ...prev, flatPlanInSummary: !prev.flatPlanInSummary }))}
            />
            <span className="palerts__master-text">
              <span className="palerts__master-title">Use flat plan in Slack summary</span>
              <span className="palerts__hint">
                When off, the target includes the pace still needed to finish the plan.
              </span>
            </span>
          </label>
        </div>

        <div className="palerts__rules">
          <div className="palerts__rules-heading">
            <span>Alert rules</span>
            <span>Slack</span>
          </div>

          <section className="palerts__sect">
            <h4 className="palerts__sect-title">Critical</h4>

            <AlertRow name="Margin below target" {...rowProps("marginBelowTarget")}>
              <span>by</span>
              <NumField
                value={draft.alerts.marginBelowTarget.gapPp}
                step={0.5}
                onChange={(v) => patchKey("marginBelowTarget", { gapPp: v })}
                ariaLabel="Margin gap, percentage points"
              />
              <span className="palerts__unit">pp</span>
            </AlertRow>

            <AlertRow name="DSP forecast overspend" {...rowProps("dspForecastOverspend")}>
              <span>forecast spend exceeds cost budget</span>
            </AlertRow>

            <AlertRow name="No delivery yet" {...rowProps("noImpressionsYet")}>
              <span>campaign started but no impressions</span>
            </AlertRow>

            {hasVideo && (
              <AlertRow name="VCR over 100%" tag="Video" {...rowProps("vcrOver100")}>
                <span>completes exceed impressions - data error</span>
              </AlertRow>
            )}
          </section>

          <section className="palerts__sect">
            <h4 className="palerts__sect-title">Warning</h4>

            <AlertRow name="Pacing off-pace" {...rowProps("pacingOffPace")}>
              <span>below</span>
              <NumField
                value={draft.alerts.pacingOffPace.low}
                onChange={(v) => patchKey("pacingOffPace", { low: v })}
                ariaLabel="Pacing low bound, percentage points"
              />
              <span>or above</span>
              <NumField
                value={draft.alerts.pacingOffPace.high}
                onChange={(v) => patchKey("pacingOffPace", { high: v })}
                ariaLabel="Pacing high bound, percentage points"
              />
              <span className="palerts__unit">pp</span>
            </AlertRow>

            <AlertRow name="CTR vs target" {...ctrCoupled}>
              <span>alert outside</span>
              <NumField
                value={ctrLow.factorPct}
                step={5}
                onChange={(v) => patchKey("ctrBelowTarget", { factorPct: v })}
                ariaLabel="CTR lower bound, percent of target"
              />
              <span className="palerts__unit">%</span>
              <span>-</span>
              <NumField
                value={ctrHigh.factorPct}
                step={5}
                onChange={(v) => patchKey("ctrAboveTarget", { factorPct: v })}
                ariaLabel="CTR upper bound, percent of target"
              />
              <span className="palerts__unit">%</span>
              <span>of target</span>
            </AlertRow>

            {hasVideo && (
              <AlertRow name="VCR vs target" tag="Video" {...rowProps("vcrBelowTarget")}>
                <span>alert below</span>
                <NumField
                  value={draft.alerts.vcrBelowTarget.factorPct}
                  step={5}
                  onChange={(v) => patchKey("vcrBelowTarget", { factorPct: v })}
                  ariaLabel="VCR lower bound, percent of target"
                />
                <span className="palerts__unit">%</span>
                <span>of target</span>
              </AlertRow>
            )}

            <AlertRow name="Bid Fact above plan" {...rowProps("bidFactAbovePlan")}>
              <SelectField
                value={bidWindow}
                options={[
                  { value: 1, label: "1 day" },
                  { value: 2, label: "2 days" },
                  { value: 3, label: "3 days" },
                ]}
                onChange={(v) => patchKey("bidFactAbovePlan", { window: v })}
                ariaLabel="Bid Fact window, days with data"
              />
              <span>window, by</span>
              <NumField
                value={draft.alerts.bidFactAbovePlan.thresholdPct}
                step={0.5}
                onChange={(v) => patchKey("bidFactAbovePlan", { thresholdPct: v })}
                ariaLabel="Bid Fact threshold, percent above plan"
              />
              <span className="palerts__unit">%</span>
            </AlertRow>

            <AlertRow name="Rate cost above plan" tag="CPC/CPV" {...rowProps("rateCostAbovePlan")}>
              <span>by</span>
              <NumField
                value={draft.alerts.rateCostAbovePlan.thresholdPct}
                onChange={(v) => patchKey("rateCostAbovePlan", { thresholdPct: v })}
                ariaLabel="Rate cost threshold, percent above plan"
              />
              <span className="palerts__unit">%</span>
            </AlertRow>

            <AlertRow name="Spend overspend" {...rowProps("spendOverspend")}>
              <span>warn at</span>
              <NumField
                value={draft.alerts.spendOverspend.warnPct}
                onChange={(v) => patchKey("spendOverspend", { warnPct: v })}
                ariaLabel="Spend warning threshold, percent of cost budget"
              />
              <span className="palerts__unit">%,</span>
              <span>critical at</span>
              <NumField
                value={draft.alerts.spendOverspend.badPct}
                onChange={(v) => patchKey("spendOverspend", { badPct: v })}
                ariaLabel="Spend critical threshold, percent of cost budget"
              />
              <span className="palerts__unit">%</span>
            </AlertRow>

            <AlertRow name="Stale data" {...rowProps("staleData")}>
              <span>after</span>
              <NumField
                value={draft.alerts.staleData.days}
                onChange={(v) => patchKey("staleData", { days: v })}
                ariaLabel="Stale data threshold, days"
              />
              <span className="palerts__unit">days</span>
            </AlertRow>
          </section>

          <section className="palerts__sect">
            <h4 className="palerts__sect-title">Info</h4>

            <AlertRow name="Data gap" {...rowProps("dataGap")}>
              <span>missing longer than</span>
              <NumField
                value={draft.alerts.dataGap.gapDays}
                onChange={(v) => patchKey("dataGap", { gapDays: v })}
                ariaLabel="Data gap threshold, days"
              />
              <span className="palerts__unit">day(s)</span>
            </AlertRow>
          </section>

          <section className="palerts__sect">
            <h4 className="palerts__sect-title">Metrics</h4>
            <label className="palerts__metric-row">
              <input
                type="checkbox"
                className="palerts__cb"
                checked={draft.vcrMetric}
                onChange={() => setDraft((prev) => ({ ...prev, vcrMetric: !prev.vcrMetric }))}
              />
              <span className="palerts__name">Include VCR/ACR column in Slack daily summary</span>
            </label>
          </section>
        </div>
      </div>
    );
  }
);
