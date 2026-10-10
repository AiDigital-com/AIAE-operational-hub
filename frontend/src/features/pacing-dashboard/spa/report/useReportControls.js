// workspace/src/pages/Dashboard/components/Widgets/Report/useReportControls.js
//
// The viewer's own state on a v2 report tile (widget-builder v2 spec 2026-08-19 §6; P2
// plan Task 10): which metric the switch is on, which dimensions the breakdown runs over,
// which period the chips have selected, and which comparison row is focused.
//
// §6 divides it in two, and this file is where that division lives:
//   · the metric, the breakdown and the DIMENSION pick are EPHEMERAL — local component
//     state, gone with the tab, never written anywhere. Nothing a viewer touches becomes
//     widget config;
//   · the period PERSISTS, in `display.widgetRanges[widget.id]`, the shared view-pref lane
//     the canonical Period control writes. That is today's behaviour and §7 forbids
//     shipping less, so a v2 chip row uses the SAME single-entry patch and the same awaited
//     catch (a stale viewer's toggle can never erase another viewer's fresh entry, and the
//     server's refusal reaches the person who clicked instead of an unhandled rejection).
//
// It is the ONLY file in the v2 read path that touches `display.widgetRanges` — the tile
// takes its window as `useWidgetData(widget, rangeOverride)` and reads no store for it,
// which is also §6's normative preview plumbing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStoreActions } from '../store.js';
import { useDashboardStore } from '../store.js';
import { toast } from '../ui/Toast.jsx';
import { saveErrorDetailText } from '../save-error.js';
import { dimensionPick, effectivePeriod } from '../report-render.js';
import { SEED_ID_BY_KEY } from '../std-catalog.js';

/** THE Breakdown tile — the instance id the seed, the migration and the Standard shelf all
 *  mint that entry under. Read from the catalogue map, never re-typed: it is the id the
 *  Settings drawer addresses its «See in Breakdown» handoff to (SettingsDrawer.jsx). */
const BREAKDOWN_TILE_ID = SEED_ID_BY_KEY['std:v2:breakdown'];

const controlOfType = (spec, type) => {
  const list = spec && Array.isArray(spec.controls) ? spec.controls : [];
  for (const c of list) if (c && c.type === type) return c;
  return null;
};

/** Two tuple keys, compared the way the panel compares them (ThirdPartyPanel.jsx:363): a
 *  focus key is an array of dimension values, and the same values in the same order are the
 *  same row. */
const sameTuple = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * useReportControls(widget, spec) → everything the controls row renders and everything the
 * views read off the viewer.
 *
 *   controlState   `{metricOptionId, breakdownIds, periodValue, dimensionKey}` — the shape
 *                  every model builder in report-render.js takes. `breakdownIds` keeps the
 *                  panel's own three-way meaning: null = follow the runtime default, [] = an
 *                  explicit "no breakdown", a list = those dimensions. `dimensionKey` is the
 *                  viewer's own pick, or null for "the switch's default".
 *   metric/period/dimension  the three switches, each `{options, value, onChange}` or null
 *                  when the widget carries no such control.
 *   breakdown      the stored control (its `maxSelected` is the whole stored rule); WHICH
 *                  dimensions it offers is resolved at runtime from the effective mapping,
 *                  so it cannot be answered here.
 *   mappingPick/pickMapping  which mapping the comparison runs over, on a pacing that
 *                  carries more than one and a widget that pinned none — the panel's own
 *                  header selector (ThirdPartyPanel.jsx:211-231), ephemeral like the metric.
 *   focusedIn/toggleFocus  the focused tuple, valid only inside the comparison it was
 *                  picked in — see focusGenerationOf (report-render.js) for why the
 *                  generation travels with the key instead of an effect clearing it.
 *
 * The metric selection is stored as "the viewer's pick, or none", and the CURRENT default
 * fills in for none on every read. The plan's letter was `useState(defaultOptionId)`; that
 * freezes the default as it stood when the tile mounted, and a linked instance whose library
 * entry re-resolves under it would then follow an option the widget no longer defaults to.
 * What every reader sees is identical: `controlState.metricOptionId` is always a concrete
 * option id.
 */
export function useReportControls(widget, spec) {
  // `campaign.id` IS the dash_slug (Pacing's own buildPacing sets it so). Read from the
  // store rather than from useParams(): this code moved out of an SPA routed at `/:slug`
  // into a Hub routed at `/campaigns/:campaignId/pacing`, where that param does not exist.
  // An undefined slug does not only break a URL - it collapses this file's per-slug cache
  // keys into one shared key, so two pacings opened inside the 30s TTL would see each
  // other's rows.
  const slug = useDashboardStore((s) => s.campaign?.id);
  // The two view-pref maps this hook reads, and nothing else. `useDisplay()` put a
  // SECOND whole-display subscription on every tile (useWidgetData had the first), so
  // any display change at all — a note, a group, a switch — re-rendered the controls
  // row of every widget on the dashboard.
  const widgetRanges = useDashboardStore((s) => s.display?.widgetRanges);
  const projectionModesMap = useDashboardStore((s) => s.display?.projectionModes);
  const { saveSettings } = useStoreActions();

  const [metricPick, setMetricPick] = useState(null);
  const [breakdownIds, setBreakdown] = useState(null);
  // Which dimension the views bound to the dimension switch are cut by (M4). EPHEMERAL, and
  // the decision is worth stating because the period chips one line down are not:
  // `display.widgetRanges` is a SHARED lane — one entry per widget for everybody who opens
  // the dashboard — so a dimension pick stored there would make one viewer's cut everyone's.
  // §6's own division puts it beside the metric and the breakdown, and the legacy Breakdown
  // panel agrees: its tab bar lives in the `brk` URL param, per viewer and per visit, and
  // nothing about it is ever written to the pacing's config.
  const [dimensionPickState, setDimensionPick] = useState(null);
  const [focus, setFocus] = useState(null);          // {key, gen} | null
  // Which mapping the comparison runs over, when the pacing carries more than one and the
  // widget did not pin one (§7.7 leaves `mapping.mode: 'runtime'` to the viewer). Ephemeral
  // like the metric pick: nothing a viewer touches becomes widget config, and the author's
  // binding in `spec.dataset.mapping` is untouched by it.
  const [mappingPick, setMappingPick] = useState(null);

  const metricControl = controlOfType(spec, 'metric');
  const periodControl = controlOfType(spec, 'period');
  const breakdownControl = controlOfType(spec, 'breakdown');
  const dimControl = controlOfType(spec, 'dimension');
  // The one-shot handoff from Settings → Mapping («See in Breakdown»): the first tile whose
  // resolved switch offers the axis takes it and clears it, so a second Breakdown widget on
  // the page does not take it too.
  //
  // NOTHING expires it on a clock (final review 2026-09-08). The drawer used to clear it 200 ms
  // after the click, and every tile is mounted lazily — DashGrid wraps each in DeferredMount
  // with a 700 px margin, and THE Breakdown tile sits at slot 900, below the line-item list —
  // so on an ordinary page the timer always won the race against the mount it was waiting for
  // and the tile opened on its own default. Three rules replace it: the drawer writes the axis
  // only when a tile that could take it is on the grid, the addressee below clears it when it
  // cannot take it, and `reset()` on a slug change clears whatever is left (dashboardStore
  // INITIAL carries `dimensionHandoff: null`).
  const widgetId = widget && widget.id;
  const handoff = useDashboardStore((s) => s.dimensionHandoff);
  useEffect(() => {
    if (!handoff) return;
    const options = dimControl && Array.isArray(dimControl.options) ? dimControl.options : [];
    if (!options.includes(handoff)) {
      // Cannot take it. THE Breakdown tile is the drawer's own first choice of addressee, so
      // when that tile is the one that cannot offer the axis — its switch collapsed below two
      // cuts in the auto pre-step, or the resolved list does not carry the source — the
      // handoff is spent rather than left waiting for a tile that will never take it. Every
      // other tile leaves it alone: it was never the addressee.
      if (widgetId === BREAKDOWN_TILE_ID
          && useDashboardStore.getState().dimensionHandoff === handoff) {
        useDashboardStore.getState().setDimensionHandoff(null);
      }
      return;
    }
    // Two offering tiles commit together: React runs both effects before either re-renders,
    // so each closure still holds the axis. The store, not the closure, says who was first.
    if (useDashboardStore.getState().dimensionHandoff !== handoff) return;
    setDimensionPick(handoff);
    useDashboardStore.getState().setDimensionHandoff(null);
  }, [handoff, dimControl, widgetId]);
  const projectionControls = ((spec && spec.controls) || [])
    .filter((control) => control && control.type === 'projection');

  // A pick that names no option of THIS switch falls back to the default, exactly as a
  // stored period outside its control's options does (effectivePeriod's own rule): stale
  // viewer state may not blank an element.
  const options = (metricControl && metricControl.options) || [];
  const metricOptionId = metricControl
    ? (options.some((o) => o.id === metricPick) ? metricPick : metricControl.defaultOptionId)
    : null;

  const { choice: periodChoice, rangeOverride, fromControl } = effectivePeriod(widget, spec, widgetRanges);
  const storedProjectionModes = (projectionModesMap && projectionModesMap[widget.id]) || {};
  const projectionModes = Object.fromEntries(projectionControls.map((control) => [
    control.id,
    storedProjectionModes[control.id] === 'reforecast' ? 'reforecast' : 'plan',
  ]));

  const controlState = useMemo(
    () => ({
      metricOptionId, breakdownIds, periodValue: rangeOverride, dimensionKey: dimensionPickState,
      projectionModes,
    }),
    [metricOptionId, breakdownIds, rangeOverride, dimensionPickState, JSON.stringify(projectionModes)],
  );
  // The pick every control-bound grain on this tile resolves through, read the same way the
  // models read it — one function, so the chip that is lit and the rows underneath it can
  // never be two different dimensions. A pick outside the switch's options falls back to
  // its default, exactly as a stale metric pick does.
  const dimensionKey = dimensionPick(spec, controlState);

  const setPeriod = useCallback(async (value) => {
    try {
      // A single-entry patch: only
      // this tile's value, merged per entry on the live row. AWAITED for the catch alone —
      // the server refuses a period saved for a widget with no Period control and it names
      // the widget, and fire-and-forget turns that sentence into an unhandled rejection
      // while the chip springs back saying nothing.
      await saveSettings(slug, { display: { widgetRanges: { [widget.id]: value ?? null } } });
    } catch (err) {
      toast(saveErrorDetailText(err, 'Could not save the period'), 'error');
    }
  }, [slug, saveSettings, widget.id]);

  const setProjection = useCallback(async (controlId, mode) => {
    try {
      await saveSettings(slug, {
        display: { projectionModes: { [widget.id]: { [controlId]: mode } } },
      });
    } catch (err) {
      toast(saveErrorDetailText(err, 'Could not save the projection'), 'error');
    }
  }, [slug, saveSettings, widget.id]);

  // The panel's own onChange (ThirdPartyPanel.jsx:218-225), minus its third line. Switching
  // the mapping changes the whole dimension space, so the breakdown goes back to "follow the
  // default" — an explicit selection of ids the NEW mapping does not carry would otherwise be
  // dropped to no breakdown at all (`selectComparisonDims` drops unknown ids) instead of to
  // that mapping's own first two dimensions. The focus needs no line here: it carries the
  // mapping id in its generation and stops being a focus the moment the id changes.
  const pickMapping = useCallback((id) => {
    setMappingPick(id);
    setBreakdown(null);
  }, []);

  const focusedIn = useCallback(
    (generation) => (focus && focus.gen === generation ? focus.key : null),
    [focus],
  );
  // Clicking the focused row clears it; clicking another moves the focus — the panel's own
  // semantics (§5.6, inherited). A key picked in a different comparison is not a re-focus
  // either: it takes the new generation, because that is the comparison it now belongs to.
  const toggleFocus = useCallback((key, generation) => {
    setFocus((cur) => (
      cur && cur.gen === generation && sameTuple(cur.key, key) ? null : { key, gen: generation }
    ));
  }, []);

  return {
    controlState,
    // The STORED options, and what each is called is the tile's own read (fix round 1) — the
    // dimension switch's rule five lines down, for a sharper reason: an auto option label is
    // §2's caption, and on three delivery metrics that caption follows the PACING («DSP CPM»,
    // «Client Cost», «VCR/ACR»). The pacing arrives with `data`, and `data` is fetched with
    // this hook's own window, so naming them here made the chip say «CPM» over a column
    // reading «DSP CPM» — one tile, one number, two names.
    metric: metricControl
      ? { id: metricControl.id, label: metricControl.label, options, value: metricOptionId, onChange: setMetricPick }
      : null,
    period: periodControl
      ? { id: periodControl.id, label: periodControl.label, options: periodControl.options, value: periodChoice, onChange: setPeriod }
      : null,
    projections: projectionControls.map((control) => ({
      id: control.id,
      label: control.label,
      options: [
        { id: 'plan', label: 'Plan' },
        { id: 'reforecast', label: 'Reforecast' },
      ],
      value: projectionModes[control.id],
      onChange: (mode) => setProjection(control.id, mode),
    })),
    // The dimension switch, in the period switch's own shape: the STORED options, the one
    // that is on, and the one way to change it. The chips are raw dimension KEYS here, the
    // way the period's are raw range values — what each is CALLED is the tile's own read of
    // the pacing's config (`dimensionLabel`), which this hook does not hold.
    dimension: dimControl
      ? { id: dimControl.id, label: dimControl.label, options: dimControl.options, value: dimensionKey, onChange: setDimensionPick }
      : null,
    breakdownControl,
    setBreakdown,
    // The viewer's mapping pick and the one way to change it. WHICH entities are on offer is
    // resolved at runtime from the pacing's own list, so — like the breakdown's dimensions —
    // it cannot be answered here.
    mappingPick,
    pickMapping,
    rangeOverride,
    fromControl,
    focusedIn,
    toggleFocus,
  };
}
