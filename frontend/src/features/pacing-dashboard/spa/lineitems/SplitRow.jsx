import { useState } from 'react';
import { formatConversion } from '../conversion-format.js';
import { CV, CV_REASON, cvStateOf, isCvUnavailable } from '../primary-cv.js';
// workspace/src/pages/Dashboard/components/LineItemList/SplitRow.jsx
import { useBreakdownFacts, useFacts, useLiPlan } from '../store.js';
import { useDashboardStore } from '../store.js';
import { useUrlFilters } from '../store.js';
import { sumDateChild, sumDimChild, sumDimMembers } from '../containers.js';
import { foldValue } from '../dim-value-groups.js';
import { buildScopedDaily, dailyForContainer } from '../container-scope.js';
import { splitActualMargin, childProgress } from '../split-metrics.js';
import { resolvePlanningScope, selectScopeFilters } from '../selectors.js';
import { rateLabel } from '../metrics.js';
import { fI, f$, fP, fDs } from '../format.js';
// Net cost mode (spec 2026-09-07 §7): margin is computed from net, and the card above
// this row says so — a split row that just says "Margin" reads as a different basis.
import { basisLabel } from '../coef-rebuild.js';
import { completionLabelForLI } from '../completion-label.js';
import { DEFAULT_COLUMNS } from '../line-item-columns.js';
// The default for a caller that hands no list: today's five (the card decides about Conv).
const NO_CONV = DEFAULT_COLUMNS.filter((k) => k !== 'conv');
import PacingCore from '../pacing-core.js';
import PaceBar from './PaceBar.jsx';

/**
 * SplitRow — sub-row for one child of a container (date or dim) inside an
 * expanded LineItemCard.
 *
 * Props:
 *   liId       {string}  line item ID
 *   kind       {'date'|'dim'}
 *   child      {object}  the date_child or dim_child object
 *   container  {object}  parent container (provides fs/fe/target_impressions)
 *   range      {object|null}  effective date range { from, to }
 *   columns    {string[]} the card's rendered column keys, in order (Line Items settings spec
 *              2026-10-01): the row prints one cell per key so the cells line up with the card's;
 *              ctr, vcr, cpa, views and daysLeft have no split reading and print "—".
 *   hasConv    {boolean}  the pre-settings flag, honoured only when `columns` is absent.
 *
 * A dim row whose value is one of the line's value groups (spec 2026-10-02) carries a toggle,
 * "3 values", and opens into its members: one line each with the member's own delivery, no
 * plan, no pacing bar. The members are summed from the same aggregate and the same window as
 * the row's own numbers, so they add up to it.
 */
/** How many members a group's row lists before "Show all N". */
const MEMBERS_SHOWN = 8;

export default function SplitRow({ liId, kind, child, container, planOverride, range, columns, hasConv = false }) {
  // The card hands `columns`; a caller still on the old `hasConv` flag gets today's cells.
  const cols = Array.isArray(columns) ? columns : (hasConv ? DEFAULT_COLUMNS : NO_CONV);
  const facts   = useBreakdownFacts();
  const rawFacts = useFacts();
  const liPlan  = useLiPlan();
  const { filters } = useUrlFilters();
  const scopeFilters = useDashboardStore((s) => selectScopeFilters(s, filters));
  const dimScope = useDashboardStore((s) => resolvePlanningScope(s, filters));
  const hasLens = (filters.platforms || []).length > 0
    || (filters.brkf || []).some(pair => !scopeFilters.brkf.includes(pair));
  const notify  = useDashboardStore((s) => s.notify);
  const spendWarn = notify?.alerts?.spend_overspend?.warn_pct ?? 90;
  const spendBad = notify?.alerts?.spend_overspend?.bad_pct ?? 100;
  const marginWarn = -(notify?.alerts?.margin_below_target?.gap_pp ?? 3);
  // A value group's row: open or closed, and whether a long list is cut. Local to the card,
  // never saved. Declared here, above the early returns, with the other hooks.
  const [membersOpen, setMembersOpen] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);

  if (!facts || !liPlan || !child || !container) return null;

  const { liDaily, liSplitDaily, asOf } = facts;
  const plan = liPlan[liId];
  if (!plan) return null;

  const isTemporal = kind === 'date';

  // ── Label / type tag / dates ────────────────────────────────────────────────
  const DIM_LBL = { audience: 'Audience', comment: 'Comment', geo: 'Geo', creative: 'Creative', message: 'Message', keyword: 'Keyword', flight: 'Flight', language: 'Language' };
  let label, typeTag, fs, fe;
  if (isTemporal) {
    label   = child.name || `${fDs(child.fs)} – ${fDs(child.fe)}`;
    typeTag = 'period';
    fs = child.fs;
    fe = child.fe;
  } else {
    const dimName = DIM_LBL[child.dim_key] || child.dim_key;
    label   = `${dimName}: ${child.dim_value}`;
    typeTag = child.dim_key;
    fs = container.fs;
    fe = container.fe;
  }
  if (planOverride) { fs = planOverride.fs; fe = planOverride.fe; }
  if (container.name) {
    typeTag = `${typeTag} · ${container.name}`;
  }
  const flightText = fs && fe ? `${fDs(fs)} – ${fDs(fe)}` : '';

  // ── Aggregate actuals ───────────────────────────────────────────────────────
  // A container whose dim splits cover it states that ALL of its units carry a
  // declared value, so its period rows count only those rows (untagged included)
  // instead of every row in the window. Not covered → the raw liDaily's delivery, unchanged.
  // Dim rows already read their own value's daily and need no scoping.
  // A date row passes its own date child: primary conversions are judged inside the row's dates,
  // the same dates the period view of this row judges (spec 2026-09-13 §4).
  const scopeIdx = buildScopedDaily(facts, liPlan, facts.rate, filters);
  const dateDaily = isTemporal ? dailyForContainer(scopeIdx, liId, container, liDaily, child) : liDaily;
  // An empty ('' / null) date is "no bound", the rule sumDateChild/sumDimChild
  // already apply; it must not become a window that excludes every day.
  const targetWindow = fs && fe ? { from: fs, to: fe } : null;
  const comparisonRange = range
    ? { from: fs && range.from < fs ? fs : range.from, to: fe && range.to > fe ? fe : range.to }
    : targetWindow;

  const act = isTemporal
    ? sumDateChild(liId, child, container, comparisonRange, dateDaily)
    : sumDimChild(liId, child, container, comparisonRange, liSplitDaily);

  // A Lens narrows the displayed actuals, not progress toward the target. This
  // second reading retains actual Scope and each container's own coverage.
  const planFacts = dimScope.active ? dimScope.facts : rawFacts;
  const planIdx = buildScopedDaily(planFacts, liPlan, planFacts.rate, scopeFilters);
  const planDaily = isTemporal ? dailyForContainer(planIdx, liId, container, planFacts.liDaily, child) : planFacts.liDaily;
  const sumPlan = (window) => isTemporal
    ? sumDateChild(liId, child, container, window, planDaily)
    : sumDimChild(liId, child, container, window, planFacts.liSplitDaily);
  const actScope = sumPlan(comparisonRange);
  const actFull = range ? sumPlan(targetWindow) : actScope;

  // ── Rate-type helpers ───────────────────────────────────────────────────────
  // Rate-native for BOTH kinds (2026-07-11): dim targets resolve off
  // container.target_impressions, which is native-unit by the planImpr
  // convention — so dim rows show and pace the same unit as temporal rows
  // (previously dim rows hardcoded impressions, comparing a clicks target
  // against an impressions actual on CPC line items).
  const rt    = plan.rateType || 'CPM';
  const uLbl  = rateLabel(rt);
  // CPI is ours (not in Pacing's reference, which has no such rate type): an install-paced line
  // counts CONVERSIONS, the population PacingCore.liActualUnits reads for it, and its cost is per
  // install (spend / conversions). Without the CPI branches a CPI split row counted impressions
  // and priced them per thousand while the line's own card counted installs.
  const nativeUnits = (a) => (rt === 'CPC' ? (a.cl || 0) : rt === 'CPV' ? (a.co || 0) : rt === 'CPI' ? (a.cv || 0) : (a.im || 0));
  const au    = nativeUnits(act);
  const rtCost = rt === 'CPC'
    ? (act.cl > 0 ? act.sp / act.cl : 0)
    : rt === 'CPV'
    ? (act.co > 0 ? act.sp / act.co : 0)
    : rt === 'CPI'
    ? (act.cv > 0 ? act.sp / act.cv : 0)
    : (act.im > 0 ? (act.sp / act.im) * 1000 : 0);

  // ── Target numerics ─────────────────────────────────────────────────────────
  const ti = planOverride ? planOverride.planImpr : isTemporal
    ? (child.target_impressions ? Number(child.target_impressions) : 0)
    : PacingCore.resolveDimAbs(child, container);
  // Dim children carry an explicit budget since F4 (2026-07-11) — the spend
  // target/proration cell works for BOTH kinds now (was temporal-only).
  const ts = planOverride ? planOverride.budget : child.target_spend != null && child.target_spend !== ''
    ? Number(child.target_spend) : 0;
  const childMg = planOverride ? planOverride.mTgt : child.margin_percent != null && child.margin_percent !== ''
    ? Number(child.margin_percent) : null;

  const auFull = nativeUnits(actFull);
  const progress = childProgress({ ti, au: auFull, fs, fe, asOf });
  // Per-LI pause: a paused LI's split demands no daily delivery (needed/day → 0)
  // and carries a muted "paused" chip. isLiPausedNow = open manual interval
  // plus schedule gaps; historical expected remains frozen as of the facts.
  const liPaused = PacingCore.isLiPausedNow(plan, asOf);

  // ── Margin (realized, from dynamic cost — consistent with LI/campaign) ───────
  // Uses the split's actual dynamic cost (act.dc, client-facing revenue), NOT
  // the prorated planned client budget. effM (target) still falls back
  // child → container → plan and feeds the Spend/Cost reference below.
  const targetChild = planOverride ? { ...child, margin_percent: planOverride.mTgt } : child;
  const { effM, marginActual, hasMargin } = splitActualMargin(act, targetChild, container, plan, marginWarn);
  const { status: marginStatus } = splitActualMargin(actScope, targetChild, container, plan, marginWarn);

  // Actuals, expected units and planned cost describe the SAME date window.
  // A child is a flat plan in its native unit; canonical proration handles the
  // selected range, asOf and parent pauses. Remaining/needed above keep the
  // full child window, independently of the displayed range.
  const { eI: sExpI, costPr, st } = PacingCore.prorateRange({
    fs, fe, planImpr: ti, budget: ts, mTgt: effM,
    containers: [], pause_intervals: plan.pause_intervals,
  }, range, asOf);

  // ── Pacing ──────────────────────────────────────────────────────────────────
  const sActive = st === 'active' || st === 'ended';
  const paceValue = sActive ? PacingCore.pacingIndex(nativeUnits(actScope), sExpI, ti) : 0;
  const paceStatus = st === 'no_overlap' ? 'no_data' : st;
  const showPace = isTemporal ? true : (ti > 0);

  // ── Spend ───────────────────────────────────────────────────────────────────
  const spendStatus = costPr > 0
    ? (actScope.sp / costPr * 100 <= spendWarn ? 'g'
      : actScope.sp / costPr * 100 <= spendBad  ? 'w'
      : 'b')
    : '';

  const statusColor = {
    g: 'var(--status-green)',
    w: 'var(--status-amber)',
    b: 'var(--status-red)',
  };

  // Per-split CVR; clicks-weighted to mirror DailyTable / KpiCards.
  const splitCvr = act.cl > 0 ? (act.cv / act.cl) * 100 : 0;
  // Primary conversions (spec 2026-09-13 §3, §4). A date row summed its container's day map
  // (dailyForContainer's wrapper carries the state), a dim row summed the split map, so it
  // asks the line item's own day state and then the split record for its dimension.
  const cvDaily = isTemporal ? dateDaily : liDaily;
  // The line item's own state first (no source, no file, or a filter that splits it), then the
  // split record for this row's dimension (spec §4 "Line item card"). A placed line item shows its
  // number clipped to the container's dates, and a planned child it never delivered into reads 0,
  // as its delivery does. A line item marked on this dimension reads "—" with the split sentence
  // where it delivers into this child in the row's dates: sumDimChild's null says so, and a
  // child its delivery does not touch there reads 0 (owner decision 2026-09-23).
  const liCv = cvStateOf(cvDaily)?.[liId]?.cv;
  const cvReason = isCvUnavailable(cvDaily, liId)
    ? (cvStateOf(cvDaily)?.[liId]?.reason || 'Conversions cannot be shown here')
    : (!isTemporal && act.cv === null)
      ? CV_REASON.DIMENSION
      : null;
  const cvPrimary = !cvReason && liCv === CV.PRIMARY;

  const dash = (key, label) => (
    <div key={key}>
      <div className="sp-ml">{label}</div>
      <div className="sp-mv" style={{ color: 'var(--text-muted)' }}>—</div>
    </div>
  );

  // ── Value group (spec 2026-10-02) ───────────────────────────────────────────
  // This row's value is a group of the line when the plan's dictionary names it. The members
  // are read even while the row is closed: the toggle counts the rows it will open.
  const group = !isTemporal
    ? (plan.dimGroups || []).find((g) => g.dim_key === child.dim_key && foldValue(g.name) === foldValue(child.dim_value)) || null
    : null;
  let members = [];
  let extraNames = [];
  if (group) {
    // One entry per value by fold: the member map keeps each row's own spelling, so `a` and
    // `A` are two keys there and must land on one line, or the members would not add up.
    const byFold = new Map();
    for (const { member, act: a } of sumDimMembers(liId, child, container, comparisonRange, liSplitDaily)) {
      const f = foldValue(member);
      const cur = byFold.get(f);
      if (!cur) byFold.set(f, { name: member, act: { ...a } });
      else for (const k of ['im', 'cl', 'sp', 'co', 'cv', 'dc']) cur.act[k] += a[k] || 0;
    }
    const known = new Set();
    for (const v of group.values) {
      const f = foldValue(v);
      if (known.has(f)) continue;
      known.add(f);
      members.push({ name: v, act: byFold.has(f) ? byFold.get(f).act : null });
    }
    // Rows that carried the group's own name (a delivered value spelled like the group).
    for (const [f, m] of byFold) if (!known.has(f)) { members.push(m); extraNames.push(m.name); }
    const unitsOf = (m) => (m.act ? nativeUnits(m.act) : -1);
    members.sort((x, y) => unitsOf(y) - unitsOf(x));          // no delivery last
  }
  const membersShown = showAllMembers ? members : members.slice(0, MEMBERS_SHOWN);
  // Primary conversions apply to this line (it has chosen actions): the group's number comes
  // from tagged conversion rows, counted per value, so a member has no number of its own.
  const memberCvKnown = liCv !== CV.PRIMARY && liCv !== CV.UNAVAILABLE;
  // CPI (ours): a member's installs ARE its conversions, so where it has no conversion number of
  // its own (the Conv cell's rule above) it has no install count and no cost per install either.
  const cpiUnknown = rt === 'CPI' && !memberCvKnown;
  const mutedDash = <div className="sp-mv" style={{ color: 'var(--text-muted)' }}>—</div>;
  const memberCell = (key, m) => {
    const a = m.act;
    const units = a ? nativeUnits(a) : 0;
    // "No delivery" means no delivery of any kind in the window, the rule containers.js uses:
    // on a CPC line a member can have impressions and spend and still no clicks.
    const delivered = !!a && (a.im > 0 || a.cl > 0 || a.co > 0 || a.sp > 0 || a.dc > 0);
    switch (key) {
      case 'margin': return (
        <div key={key}>
          <div className="sp-ml">{basisLabel('Margin', 'margin', plan.k > 0 && plan.k < 1)}</div>
          {a && a.dc > 0 ? <div className="sp-mv">{fP(PacingCore.margin(a.dc, a.sp))}</div> : mutedDash}
        </div>
      );
      case 'spend': return (
        <div key={key}>
          <div className="sp-ml">Spend</div>
          <div className="sp-mv">{f$(a ? a.sp : 0)}</div>
        </div>
      );
      case 'units': return (
        <div key={key}>
          <div className="sp-ml">{uLbl}</div>
          {cpiUnknown ? mutedDash : <div className="sp-mv">{fI(units)}</div>}
          {cpiUnknown ? null : !delivered
            ? <div className="sp-ms">no delivery yet</div>
            : (au > 0 && <div className="sp-ms">{Math.round((units / au) * 100)}% of {group.name}</div>)}
        </div>
      );
      case 'pacing': return <div key={key} />;
      case 'rate': {
        // The group row's own rule (rtCost above): per click, per completed view, per install
        // (CPI, ours), and per thousand impressions for every other rate type (Flat included).
        const denom = !a || cpiUnknown ? 0 : rt === 'CPC' ? a.cl : rt === 'CPV' ? a.co : rt === 'CPI' ? a.cv : a.im;
        const cost = denom > 0 ? (rt === 'CPC' || rt === 'CPV' || rt === 'CPI' ? a.sp / denom : (a.sp / denom) * 1000) : 0;
        return (
          <div key={key}>
            <div className="sp-ml">{rt}</div>
            {denom > 0 ? <div className="sp-mv">{f$(cost)}</div> : mutedDash}
          </div>
        );
      }
      case 'conv': return (
        <div key={key}>
          <div className="sp-ml">Conv</div>
          {memberCvKnown && a && a.cv > 0 ? (
            <>
              <div className="sp-mv">{formatConversion(a.cv)}</div>
              <div className="sp-ms">CVR {fP(a.cl > 0 ? (a.cv / a.cl) * 100 : 0)}</div>
            </>
          ) : mutedDash}
        </div>
      );
      case 'clicks': return (
        <div key={key}>
          <div className="sp-ml">Clicks</div>
          <div className="sp-mv">{fI(a ? a.cl : 0)}</div>
        </div>
      );
      // The plan side has no member reading: the cell keeps its place and prints a dash.
      case 'budget': return dash(key, basisLabel('Client budget', 'net', plan.k > 0 && plan.k < 1));
      case 'neededPerDay': return dash(key, 'Needed / day');
      case 'ctr': return dash(key, 'CTR');
      case 'vcr': return dash(key, completionLabelForLI(plan));
      case 'cpa': return dash(key, 'CPA');
      case 'views': return dash(key, 'Views');
      case 'daysLeft': return dash(key, 'Days left');
      default: return null;
    }
  };
  const cellOf = (key) => {
    switch (key) {
      case 'margin': return (
        <div key={key}>
          <div className="sp-ml">{basisLabel('Margin', 'margin', plan.k > 0 && plan.k < 1)}</div>
          {hasMargin ? (
            <>
              <div className="sp-mv" style={{ color: hasLens || plan.coef === true ? 'inherit' : (statusColor[marginStatus] ?? 'inherit') }}>
                {fP(marginActual)}
              </div>
              <div className="sp-ms">tgt {fP(effM)}</div>
            </>
          ) : childMg != null ? (
            <>
              <div className="sp-mv" style={{ color: 'var(--text-muted)' }}>—</div>
              <div className="sp-ms">tgt {fP(childMg)}</div>
            </>
          ) : (
            <div className="sp-mv" style={{ color: 'var(--text-muted)' }}>—</div>
          )}
        </div>
      );
      case 'spend': return (
        <div key={key}>
          {costPr > 0 ? (
            <>
              <div className="sp-ml">Spend / Cost</div>
              <div className="sp-mv" style={{ color: !hasLens && spendStatus ? statusColor[spendStatus] : 'inherit' }}>
                {f$(act.sp)}
              </div>
              <div className="sp-ms">{f$(costPr)} pror.</div>
            </>
          ) : (
            <>
              <div className="sp-ml">Spend</div>
              <div className="sp-mv">{f$(act.sp)}</div>
            </>
          )}
        </div>
      );
      case 'units': return (
        <div key={key}>
          <div className="sp-ml">{uLbl}</div>
          <div className="sp-mv">{fI(au)}</div>
          {ti > 0 && (
            <div className="sp-ms">{fI(Math.round(sExpI))} expected</div>
          )}
          {ti > 0 && progress.state === 'active' && (
            // needed/day uses ceil (not the campaign-level round) so a tiny
            // positive remainder never displays as "0/day" while work is left.
            <div className="sp-ms">
              {fI(Math.round(progress.remaining))} left · {fI(Math.ceil(liPaused ? 0 : progress.neededPerDay))}/day
            </div>
          )}
          {ti > 0 && progress.state === 'ended' && progress.remaining > 0 && (
            <div className="sp-ms" style={{ color: 'var(--status-red)' }}>
              {fI(Math.round(progress.remaining))} short
            </div>
          )}
        </div>
      );
      case 'pacing': return (
        <div key={key}>
          {showPace ? (
            <>
              <div className="sp-ml" title={hasLens ? 'Pacing uses Scope delivery and plan. Lens filters the displayed delivery.' : undefined}>
                {hasLens ? 'Pacing · Scope' : 'Pacing'}
              </div>
              <PaceBar value={paceValue} status={paceStatus} />
            </>
          ) : (
            <div />
          )}
        </div>
      );
      case 'rate': return (
        <div key={key}>
          <div className="sp-ml">{rt}</div>
          <div className="sp-mv">{f$(rtCost)}</div>
        </div>
      );
      case 'conv': return (
        <div key={key} title={cvReason || undefined}>
          <div className="sp-ml">Conv</div>
          {!cvReason && ((act.cv || 0) > 0 || cvPrimary) ? (
            <>
              <div className="sp-mv">{formatConversion(act.cv || 0)}</div>
              <div className="sp-ms">CVR {fP(splitCvr)}</div>
            </>
          ) : (
            <div className="sp-mv" style={{ color: 'var(--text-muted)' }}>—</div>
          )}
        </div>
      );
      case 'clicks': return (
        <div key={key}>
          <div className="sp-ml">Clicks</div>
          <div className="sp-mv">{fI(act.cl || 0)}</div>
        </div>
      );
      case 'budget': return ts > 0 ? (
        <div key={key}>
          <div className="sp-ml">{basisLabel('Client budget', 'net', plan.k > 0 && plan.k < 1)}</div>
          <div className="sp-mv">{f$(ts)}</div>
        </div>
      ) : dash(key, basisLabel('Client budget', 'net', plan.k > 0 && plan.k < 1));
      case 'neededPerDay': return ti > 0 && progress.state === 'active' ? (
        <div key={key}>
          <div className="sp-ml">Needed / day</div>
          <div className="sp-mv">{fI(Math.ceil(liPaused ? 0 : progress.neededPerDay))}</div>
          <div className="sp-ms">{fI(Math.round(progress.remaining))} left</div>
        </div>
      ) : dash(key, 'Needed / day');
      // No split reading for these (spec 2026-10-01): the cell keeps its place so the
      // columns line up with the card above, and prints a dash.
      case 'ctr': return dash(key, 'CTR');
      case 'vcr': return dash(key, completionLabelForLI(plan));
      case 'cpa': return dash(key, 'CPA');
      case 'views': return dash(key, 'Views');
      case 'daysLeft': return dash(key, 'Days left');
      default: return null;
    }
  };

  return (
    <>
    <div className="sp-row">
      <div className="sp-spacer" />
      <div className="sp-head" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', paddingLeft: '32px' }}>
        <span className="sp-dot" />
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span className="sp-nm">{label}</span>
            <span className="sp-tg">{typeTag}</span>
            {group && (
              <button
                type="button"
                className="sp-vg-toggle"
                aria-expanded={membersOpen}
                onClick={() => setMembersOpen((v) => !v)}
                title={`${group.name} = ${[...group.values, ...extraNames].join(', ')}`}
              >
                {members.length} value{members.length === 1 ? '' : 's'}
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
              </button>
            )}
            {liPaused && (
              <span className="text-9" style={{
                fontFamily: 'var(--font-barlow)', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--text-secondary)', background: 'var(--surface-tertiary)',
                padding: '2px 6px', borderRadius: 'var(--rp)', whiteSpace: 'nowrap',
              }}>
                paused
              </span>
            )}
          </div>
          {flightText && <div className="sp-fl">{flightText}</div>}
        </div>
      </div>
      {cols.map(cellOf)}
    </div>
    {group && membersOpen && membersShown.map((m, i) => {
      const last = i === membersShown.length - 1 && membersShown.length === members.length;
      return (
        <div key={`member:${m.name}`} className={`sp-row sp-row--member${last ? ' sp-row--member-last' : ''}`}>
          <div className="sp-spacer" />
          <div className="sp-head" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', paddingLeft: '52px' }}>
            <div><span className="sp-nm">{m.name}</span></div>
          </div>
          {cols.map((key) => memberCell(key, m))}
        </div>
      );
    })}
    {group && membersOpen && members.length > membersShown.length && (
      <div className="sp-row sp-row--member sp-row--member-last">
        <div className="sp-spacer" />
        <div className="sp-head" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', paddingLeft: '52px' }}>
          <button type="button" className="sp-vg-toggle sp-vg-toggle--more" onClick={() => setShowAllMembers(true)}>
            Show all {members.length}
          </button>
        </div>
      </div>
    )}
    </>
  );
}
