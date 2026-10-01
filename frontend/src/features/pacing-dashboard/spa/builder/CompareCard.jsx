// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/CompareCard.jsx
//
// THE COMPARE CARD (widget-builder v2 §5.5 + §5.6, mockup §2). Delivery beside CM360, as a
// card in the builder's Views list.
//
// It takes the CARD INTERFACE `ChartCard.jsx` states, plus ONE prop the other four do not
// read — `onRemoveControl(type)`. The reason is below.
//
// THIS VIEW STORES NO VALUE. It is the only kind that does not: what it draws is decided by
// the two CONTROLS it names (§5.5) and by the mapping, resolved at runtime. So the card has
// no value chip and no ƒx door — its subject is the two controls, and the wires it declares.
//
// THREE RULES SHAPE IT:
//
//   1. THE TWO CONTENT ROWS OPEN THE SHARED CONTROL. The builder handles navigation;
//      standalone cards use the same settings components locally.
//   2. REMOVING A CONTROL IS THE BUILDER'S QUESTION. Those panels' `onRemove` "goes back to
//      the BUILDER, which owns the confirm" (T9's contract) — and it has to: what a metric
//      switch takes with it is every bound element ACROSS the report plus every compare view
//      that names it, and this card can see one view. So the ask is forwarded, unchanged,
//      through `onRemoveControl` rather than answered here with a second, smaller confirm.
//   3. A WIRE IS DECLARED, NEVER IMPLIED (§5.6). A compare view narrows a chart only because
//      the spec says so, so every wire is a chip you can see and a × you can press. The
//      first one arrives with the view when there is exactly one chart to name (`addView`);
//      the rest are picked here, one at a time.
//
// THE CAP IS NOT ON SCREEN, deliberately. `LIMITS.interactions` is 16 and the grammar calls
// it "a DoS rail, not a modelling cap": six views give at most nine distinct pairs, and a
// repeat is refused before the cap is ever counted. A `N of 16` on the button would teach a
// limit this window cannot reach, and every already-wired chart is named in the map anyway.
import { useId, useMemo, useRef, useState } from 'react';
import CompactPicker from './CompactPicker.jsx';
import { useControlNavigation } from './ControlNavigation.jsx';
import { metricControlSummary } from './control-connections.js';
import { flattenViews } from '../report-v2.js';
import { addInteraction, chartAnswersFocus, removeInteraction, setViewTitle } from '../report-draft.js';
import { spotlightItems } from '../spotlight-items.js';
import { BreakdownPopover, MetricSwitchPopover, controlRefusal } from './ControlPopovers.jsx';
import ContentRow from './ContentRow.jsx';
import ViewFrame from './ViewFrame.jsx';
import { chartSeriesNames, viewName } from './view-text.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const NO_ITEMS = [];
const SPOT_LABEL = 'Link to chart';
const SPOT_ANCHOR = 'link';
const LINK_PREFIX = 'link:';
/** What a `tupleFocus` DOES, in the words the tile prints on the comparison it runs from:
 *  `ReportCompare` draws «Overlap only» over the chart, and only an Overlap row has a
 *  delivery side and a CM360 side to narrow the chart to. */
const FOCUS_NOTE = 'Only Overlap rows focus a chart.';
/** …and why the row offers nothing. A fact about THIS report, so it is worded here — and it
 *  is a sentence rather than a disabled button, because there is no map row to hang a
 *  reason on and a door onto an empty list explains nothing (§1.1.3). */
const NO_CHART = 'This Widget has no chart view to focus a row into.';
/** A control the view names and the draft no longer has. Reachable: the Controls row can
 *  remove the switch (it asks first, and the confirm names this view). Its place still
 *  says what is missing, and the footer carries the grammar's own refusal. */
const GONE = 'the switch it named is gone';

// `env` and `onDraftInvalid` are part of the card interface and are unread here: this
// card's one map lists VIEWS (no grain, no dimension) and carries no formula slot, so
// nothing on it can leave a half typed expression behind.
export default function CompareCard({
  view, spec, widget, patch, first, last, onMove, onDropAt, onRemove, onRemoveControl,
  embedded = false,
}) {
  const metricRef = useRef(null);
  const brkRef = useRef(null);
  const linkRef = useRef(null);
  const firstRef = useRef(null);
  const navigation = useControlNavigation();
  const errorId = useId();
  const [panel, setPanel] = useState(null);
  const [spot, setSpot] = useState(false);

  const controls = arr(spec && spec.controls);
  const metric = controls.find((c) => c && c.type === 'metric' && c.id === view.metricControlId) || null;
  const breakdown = controls.find((c) => c && c.type === 'breakdown' && c.id === view.breakdownControlId) || null;
  const refusals = useMemo(() => ({
    metric: metric ? controlRefusal(widget, 'metric') : null,
    breakdown: breakdown ? controlRefusal(widget, 'breakdown') : null,
  }), [widget, metric, breakdown]);

  const views = flattenViews(spec?.views);
  const charts = views.filter((v) => v && v.kind === 'chart');
  // Every wire this view is the SOURCE of. A compare view is never a target (§5.6 runs
  // compare → chart), so there is only one end to read.
  const wires = arr(spec && spec.interactions).filter((it) => it && it.sourceViewId === view.id);
  const nameOfView = (id) => {
    const hit = views.find((v) => v && v.id === id);
    return hit ? viewName(hit, spec) : '—';
  };

  const items = useMemo(() => (spot ? spotlightItems(SPOT_ANCHOR, {
    charts: charts.map((v) => ({
      id: v.id, label: viewName(v, spec), note: chartSeriesNames(v, spec),
      // The same rule addView applies to the auto-wire: a chart with no series the focus
      // narrows cannot answer this link, so the map refuses it with the reason in place.
      answers: chartAnswersFocus(v, widget.datasetType),
    })),
    linked: wires.map((it) => it.targetViewId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }) : NO_ITEMS), [spot, spec, view.id]);

  const openPanel = (which) => {
    setSpot(false);
    const control = which === 'metric' ? metric : breakdown;
    if (control && navigation?.openControl) {
      setPanel(null);
      navigation.openControl(control.id, (which === 'metric' ? metricRef : brkRef).current);
    } else setPanel(which);
  };
  const openSpot = () => { setPanel(null); setSpot(true); };

  const chartLinks = (
      <div className="sp-rb-els">
        {wires.map((it) => {
          const name = nameOfView(it.targetViewId);
          return (
            <ContentRow key={it.id} label={name} roleLabel="Chart"
              summary="Filters from selected comparison row"
              onOpen={() => navigation?.revealConnection?.({ viewId: it.targetViewId, kind: 'chart', label: name })}
              buttonProps={{ 'aria-haspopup': undefined,
                'aria-label': `Show ${name} in widget content`,
                disabled: !navigation?.revealConnection }}
              actions={<button
                type="button" className="sp-rb-btn sp-rb-btn--rm"
                title="Remove link" aria-label={`Remove the link to ${name}`}
                onClick={() => patch((s) => removeInteraction(s, it.id))}
              >×</button>}
            />
          );
        })}
        {charts.length ? (
          <button
            ref={linkRef} type="button" className="sp-rb-btn sp-content-add"
            onClick={openSpot}
          >
            + Link to chart
          </button>
        ) : (
          <span className="sp-rb-why">{NO_CHART}</span>
        )}
        {/* The note qualifies a wire, so it is printed where there is one to qualify or one
            to make. On a report with neither it would be a rule about nothing. */}
        {charts.length || wires.length ? <span className="sp-rb-note">{FOCUS_NOTE}</span> : null}
      </div>

  );

  return (
    <ViewFrame
      embedded={embedded}
      view={view} spec={spec} first={first} last={last}
      onMove={onMove} onDropAt={onDropAt} onRemove={onRemove}
      onTitle={(title) => patch((s) => setViewTitle(s, view.id, title))}
    >
      <div className="sp-rb-els">
        {metric ? (
          <div className="sp-content-item">
            <ContentRow
              buttonRef={metricRef} label={metric.label || 'Metric'} roleLabel={metric.label && metric.label !== 'Metric' ? 'Metric' : undefined}
              summary={metricControlSummary(metric, spec)}
              marker={<span className="sp-rb-bind" role="img" aria-label="the viewer switches this">⇄</span>}
              open={panel === 'metric'} onOpen={() => openPanel('metric')}
              buttonProps={{ 'aria-invalid': refusals.metric ? true : undefined,
                'aria-describedby': refusals.metric ? `${errorId}-metric` : undefined }}
            />
            {refusals.metric ? <div id={`${errorId}-metric`} className="sp-lay-refusal" role="status">{refusals.metric}</div> : null}
          </div>
        ) : (
          <span className="sp-rb-empty">{`Metric: ${GONE}`}</span>
        )}

        {breakdown ? (
          <div className="sp-content-item">
            <ContentRow
              buttonRef={brkRef} label={breakdown.label || 'Breakdown'} roleLabel={breakdown.label && breakdown.label !== 'Breakdown' ? 'Breakdown' : undefined}
              summary={breakdown.maxSelected == null ? null : `Up to ${breakdown.maxSelected} dimensions`}
              open={panel === 'breakdown'} onOpen={() => openPanel('breakdown')}
              buttonProps={{ 'aria-invalid': refusals.breakdown ? true : undefined,
                'aria-describedby': refusals.breakdown ? `${errorId}-breakdown` : undefined }}
            />
            {refusals.breakdown ? <div id={`${errorId}-breakdown`} className="sp-lay-refusal" role="status">{refusals.breakdown}</div> : null}
          </div>
        ) : (
          <span className="sp-rb-empty">{`Breakdown: ${GONE}`}</span>
        )}
      </div>

      {embedded ? <>
        <p className="sp-inspector-help">These switches also update other elements connected to them.</p>
        <details className="sp-inspector-details"><summary>Chart links</summary><div className="sp-inspector-detail-body">{chartLinks}</div></details>
      </> : chartLinks}

      {panel === 'metric' && metric ? (
        <MetricSwitchPopover
          widget={widget} control={metric} hideRefusal
          anchorRef={metricRef} firstRef={firstRef} patch={patch}
          onRemove={() => onRemoveControl?.('metric')}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'breakdown' && breakdown ? (
        <BreakdownPopover
          widget={widget} control={breakdown} hideRefusal
          anchorRef={brkRef} firstRef={firstRef} patch={patch}
          onRemove={() => onRemoveControl?.('breakdown')}
          onClose={() => setPanel(null)}
        />
      ) : null}

      <CompactPicker
        open={spot}
        title={SPOT_LABEL}
        anchorRef={linkRef}
        items={items}
        onPick={(item) => {
          const targetViewId = String(item.id).slice(LINK_PREFIX.length);
          patch((s) => addInteraction(s, { type: 'tupleFocus', sourceViewId: view.id, targetViewId }));
          setSpot(false);
        }}
        onClose={() => setSpot(false)}
      />
    </ViewFrame>
  );
}
