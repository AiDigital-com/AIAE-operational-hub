// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/SeriesPopover.jsx
//
// ONE series' settings (widget-builder v2 §5.1, mockup §2): the panel a series row opens.
// The row is the thing, this is its settings — §1.1.5's one mental primitive, and the row
// stays legible without it (§3: popovers are for editing only).
//
// Three rules shape what is in here:
//
//   1. EVERY PICKER IS FILLED FROM THE GRAMMAR. Style types, stroke widths, curves, fills,
//      bar modes, axes, accumulate modes and the colour slots all come from
//      `@shared/report-v2` through the door. A list retyped here would offer a value
//      `normSeries` refuses, and the author would read the refusal after the save.
//
//   2. A REFUSAL IS THE GRAMMAR'S OWN SENTENCE. The Axis row does not know the axis rules:
//      it asks `validateReportDraft` what would happen if this series moved, and prints
//      what comes back. That sentence names the conflicting series, because the grammar
//      names it — a second wording here would be a second rule to keep in step.
//
//   3. NOTHING IS WRITTEN THAT THE GRAMMAR DOES NOT HAVE. Every edit goes through the pure
//      mutators, which assemble in Table E's key order; the style morph in particular is
//      `setSeriesStyle`'s job, because a bar carries neither stroke nor fill and spreading
//      `{type:'bar'}` over a line style fails the whole draft with «unknown key».
//
// A CALC series (Plan / Needed) gets three rows and no more: it draws the plan, so it has no
// value to pick, no source to read it from and no unit to place. Colour, label, remove — plus
// the ▲▼ pair, which every series needs because it is the only way any of them reorders.
import { SwitchAction } from './ContextualSwitch.jsx';
import { useId, useMemo } from 'react';
import Popover from '../Popover.jsx';
import {
  ACCUMULATE_MODES, ADDITIVE_FAMILIES, AREA_FILLS, AXES, BAR_MODES, CURVES, LIMITS,
  DASH_PATTERNS, EXACT_STROKE_WIDTHS, PROJECTION_BASES,
  PROJECTION_OUTPUTS, STROKE_WIDTHS, STYLE_TYPES, flattenViews,
} from '../report-v2.js';
import { entriesFor, entryOf, familyOf, mintValue } from '../metric-catalog.js';
import { autoLabel, grainTypeOf, resolveValue, CALC_LABELS } from '../report-render.js';
import {
  datasetTypeOf, moveSeries, patchSeries, removeSeries, setAxisFormat, setSeriesStyle,
} from '../report-draft.js';
import { askOn, seriesAt } from './ask-grammar.js';
import { autoAxisFormat, axisFamilies } from './chart-axis.js';
import { seriesName } from './view-text.js';
import { GROUP_LABEL, sourceEnv, sourcesFor } from '../spotlight-items.js';
import { OrderRow, PaintSelect, PopRow, Seg, word } from './rows.jsx';
import { FollowsNote, SourceRow } from './ValueRow.jsx';

const arr = (v) => (Array.isArray(v) ? v : []);
/** No store under this panel: cm stays unpickable, which is what it was before the pacing's
 *  own facts reached the builder. */
const EMPTY_ENV = {};
const seg = (list) => list.map((v) => [v, word(v)]);
/** The switch option, first in the Value list when the switch can land on this metric. */
const BOUND_OPTION = 'Metric switch ⇄';

/**
 * SeriesPopover — the settings of one series.
 *
 *   widget        the whole draft widget; the Axis row judges a candidate against it
 *   view          the chart this series belongs to
 *   series        the series itself
 *   anchorRef     the row this panel hangs from
 *   valueRef      where focus lands on open (§3: the Value select)
 *   more          is `▸ More` expanded? Owned by the card across value picker hand-offs.
 *   patch         the builder's ONE write path, `(mutate) => …`
 *   onPickValue   open the Spotlight on this series' value
 */
export default function SeriesPopover({
  widget, view, series, anchorRef, valueRef, more, onMore, env = EMPTY_ENV, patch,
  onPickValue, onClose, onMakeSwitchable,
}) {
  const spec = widget.spec;
  const datasetType = datasetTypeOf(spec);
  // The pacing's own half of a source verdict (spec 2026-08-25 §4), for the Value select's
  // re-mint and the Source row under it — the same env the card judged its map in.
  const srcEnv = { ...sourceEnv(env), anchor: 'chart' };
  const isCalc = series.kind === 'calc';
  const value = series.value || null;
  const entry = entryOf(value, datasetType);
  const resolved = resolveValue(value, spec, null);
  const title = isCalc
    ? (series.labelAuto ? (CALC_LABELS[series.calc] || series.calc) : series.label)
    : 'Series settings';

  const patchThis = (p) => patch((s) => patchSeries(s, view.id, series.id, p));
  const patchStyle = (style) => patch((s) => setSeriesStyle(s, view.id, series.id, style));

  return (
    <Popover
      anchorRef={anchorRef}
      open
      onClose={onClose}
      title={title}
      // 324, not the shell's 288 default: the palette row is nine chips, and since T13 they
      // sit 6px apart so their 24px hit areas stop overlapping — 210px of chips, under a
      // label column that is now 66. Measured in the built app; at anything narrower the row
      // wraps onto a second line, and a setting that changes shape between two panels is a
      // setting that reads as two.
      width={360}
      initialFocus={isCalc ? 'first' : valueRef}
    >
      {isCalc ? null : (
        <>
          <ValueRow
            widget={widget} view={view} series={series} entry={entry} value={value}
            datasetType={datasetType} valueRef={valueRef} env={srcEnv} patch={patch}
            onPickValue={onPickValue}
          />
          {onMakeSwitchable ? <SwitchAction env={env} widget={widget} slot={{viewId:view.id,kind:'series',elementId:series.id}} onClick={onMakeSwitchable} /> : null}
          <SourceRow
            value={value} entry={entry} datasetType={datasetType} env={srcEnv}
            onPick={(next) => patchThis({ value: next })}
          />
        </>
      )}

      {series.calc === 'projection' ? (
        <ProjectionRows spec={spec} series={series} patchThis={patchThis} />
      ) : null}

      <StyleRow style={series.style} onStyle={patchStyle} />
      <AxisRow widget={widget} view={view} series={series} onPick={(a) => patchThis({ axis: a })} />

      <PopRow label="Color">
        <PaintSelect label="Color" value={series.color} onPick={(color) => patchThis({ color })} />
      </PopRow>

      <PopRow label="Label">
        <input
          type="text"
          className="sp-inp sp-inp--sm sp-inp--sans sp-pop-inp"
          aria-label="Label"
          maxLength={LIMITS.label}
          value={series.labelAuto ? '' : series.label}
          placeholder={isCalc ? (CALC_LABELS[series.calc] || series.calc) : (autoLabel(resolved) || '—')}
          onChange={(e) => patchThis({ label: e.target.value.slice(0, LIMITS.label) })}
        />
      </PopRow>

      <button
        type="button"
        className="sp-pop-more"
        aria-expanded={!!more}
        onClick={() => onMore(!more)}
      >
        {more ? '▾ Less' : '▸ More'}
      </button>
      {more ? (
        <MoreRows
          spec={spec} view={view} series={series} value={value} patch={patch} patchThis={patchThis}
          onStyle={patchStyle}
        />
      ) : null}

      <button
        type="button"
        className="sp-pop-rm"
        onClick={() => { patch((s) => removeSeries(s, view.id, series.id)); onClose(); }}
      >
        Remove from chart
      </button>
      <FollowsNote value={value} />
    </Popover>
  );
}

/* ── the Value row ────────────────────────────────────────────────────────── */

/**
 * What this series draws (§2). The switch comes first whenever the widget HAS one, then the
 * catalog in the map's own groups — every entry, with the ones that cannot be picked here
 * disabled AND carrying the reason (§1.1.3), because a picker that quietly shortened its
 * list is what makes people believe a metric does not exist.
 *
 * No per-metric reachability test, unlike the Spotlight's source step: there ⇄ is one way of
 * reading the metric being ADDED, so it is offered only when the switch's options can land
 * on it. Here ⇄ REPLACES the whole value with the switch's own — there is no «this metric»
 * for it to be reachable on.
 *
 * A FORMULA is not in the catalog and cannot be, so it shows as its own option and the ƒx
 * button beside the select is the way back to the editor that wrote it.
 */
function ValueRow({ widget, view, series, entry, value, datasetType, valueRef, env, patch, onPickValue }) {
  const spec = widget.spec;
  const hasSwitch = arr(spec.controls).some((c) => c && c.type === 'metric');
  const isFormula = !!value && value.kind === 'formula';
  // The SAME env the Spotlight judges a replacement pick in, because they are the same
  // question asked through two doors: this series' own accumulate and axis, and the
  // families every OTHER series draws — the value being replaced is not its own neighbour.
  const judged = useMemo(() => entriesFor({
    datasetType,
    anchor: 'series',
    // The RESOLVED axis (M4): a control axis is judged as the dimension it resolves to,
    // the same read the card behind this panel makes for its own map.
    grain: grainTypeOf(view.x),
    hasMetricControl: hasSwitch,
    accumulate: series.accumulate,
    axis: series.axis,
    axisFamilies: axisFamilies(view, spec, series.id),
  }), [datasetType, view, spec, hasSwitch, series.accumulate, series.axis, series.id]);

  const groups = [];
  for (const row of judged) {
    const label = GROUP_LABEL[row.entry.group] || row.entry.group;
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, rows: [] });
    groups[groups.length - 1].rows.push(row);
  }

  const cur = value && value.kind === 'bound' ? 'bound' : (isFormula ? 'formula' : (entry && entry.id) || '');

  const onChange = (next) => {
    if (next === 'formula') return;   // the ƒx button owns that door — see below
    if (next === 'bound') { patch((s) => patchSeries(s, view.id, series.id, { value: { kind: 'bound' } })); return; }
    const picked = judged.find((r) => r.entry.id === next);
    if (!picked) return;
    // The source the series already reads, when the new metric is also read from it —
    // switching Impressions for Clicks on a CM360 widget must not silently move a line back
    // to the delivery side.
    const sources = sourcesFor(picked.entry, { ...env, datasetType, held: value && value.source });
    const source = value && sources.includes(value.source) ? value.source : sources[0];
    patch((s) => {
      const next2 = patchSeries(s, view.id, series.id, {
        value: mintValue(picked.entry, { source, datasetType }),
      });
      const v = flattenViews(next2.views).find((x) => x?.id === view.id);
      const auto = v && autoAxisFormat(v, next2, series.id, picked.entry);
      return auto ? setAxisFormat(next2, view.id, auto.side, auto.format) : next2;
    });
  };

  return (
    <PopRow label="Value">
      <select
        ref={valueRef}
        className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
        aria-label="Value"
        value={cur}
        onChange={(e) => onChange(e.target.value)}
      >
        {hasSwitch ? <option value="bound">{BOUND_OPTION}</option> : null}
        {isFormula ? <option value="formula">{`ƒ ${value.expr}`}</option> : null}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.rows.map(({ entry: e, available, reason }) => (
              <option key={e.id} value={e.id} disabled={!available}>
                {available ? e.label : `${e.label} · ${reason}`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button type="button" className="sp-pop-fx" title="Custom formula" aria-label="Custom formula" onClick={onPickValue}>ƒx</button>
    </PopRow>
  );
}

/* ── style, and what each style has ───────────────────────────────────────── */

/** Table F: the TYPE decides the key set, so the rows below it change with it. Mixing
 *  styles on one chart is core behaviour on any X (§5.1) — nothing here is decided from
 *  the data choice. */
function StyleRow({ style, onStyle }) {
  const type = (style && style.type) || 'line';
  return (
    <PopRow label="Style">
      <Seg label="Style" value={type} options={seg(STYLE_TYPES)} onPick={(t) => onStyle({ type: t })} />
    </PopRow>
  );
}

/** Stroke/bar details live behind the explicit More disclosure. At rest the popover stays a
 * short settings card; opening More reveals every exact wire value without a nested scroll
 * box or a second generic Options surface. */
export function StyleDetailRows({ style, onStyle }) {
  const type = (style && style.type) || 'line';
  const widths = [...STROKE_WIDTHS, ...EXACT_STROKE_WIDTHS].map((v) => [v, String(v)]);
  return (
    <>
      {type === 'bar' ? (
        <>
          <PopRow label="Layout">
            <Seg label="Layout" value={style.bars} options={seg(BAR_MODES)} onPick={(b) => onStyle({ bars: b })} />
          </PopRow>
          <PopRow label="Width">
            <select
              className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
              aria-label="Width"
              value={style.width == null ? 'normal' : style.width}
              onChange={(e) => onStyle({ width: numberOrWord(e.target.value) })}
            >
              {widths.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </PopRow>
        </>
      ) : (
        <>
          <PopRow label="Width">
            <select
              className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
              aria-label="Width"
              value={style.width}
              onChange={(e) => onStyle({ width: numberOrWord(e.target.value) })}
            >
              {widths.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </PopRow>
          <PopRow label="Curve">
            <Seg label="Curve" value={style.curve} options={seg(CURVES)} onPick={(c) => onStyle({ curve: c })} />
          </PopRow>
          <PopRow label="Points">
            <Seg label="Points" value={!!style.points} options={[[false, 'Off'], [true, 'On']]} onPick={(p) => onStyle({ points: p })} />
          </PopRow>
          {type === 'area' ? (
            <PopRow label="Fill">
              <Seg label="Fill" value={style.fill} options={seg(AREA_FILLS)} onPick={(f) => onStyle({ fill: f })} />
            </PopRow>
          ) : null}
        </>
      )}
    </>
  );
}

const numberOrWord = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && String(number) === String(value) ? number : value;
};

/** The projection calculation's three authored decisions. Omitting modeControlId means
 * fixed Plan; naming the Widget's Projection control lets the viewer choose Plan or
 * Reforecast. Every edit is a partial series patch, so output/basis/control and every
 * presentation field beside them survive one another. */
export function ProjectionRows({ spec, series, patchThis, onAddControl }) {
  const control = arr(spec && spec.controls).find((c) => c && c.type === 'projection') || null;
  const modeOptions = [[null, 'Fixed plan']];
  if (control) modeOptions.push([control.id, 'Viewer switch']);
  return (
    <>
      <PopRow label="Basis">
        <Seg
          label="Projection basis" value={series.basis}
          options={PROJECTION_BASES.map((basis) => [basis, projectionBasisWord(basis)])}
          onPick={(basis) => patchThis({ basis })}
        />
      </PopRow>
      <PopRow label="Output">
        <Seg
          label="Projection output" value={series.output}
          options={PROJECTION_OUTPUTS.map((output) => [output, output === 'perDay' ? 'Per day' : 'Cumulative'])}
          onPick={(output) => patchThis({ output })}
        />
      </PopRow>
      <PopRow
        label="Mode"
        note={control ? 'Viewer starts on Plan; Reforecast is their alternate.' : onAddControl ? null : 'Add a Projection switch in Controls to let the viewer choose Reforecast.'}
      >
        <Seg
          label="Projection mode" value={series.modeControlId || null}
          options={modeOptions}
          onPick={(modeControlId) => patchThis({ modeControlId })}
        />
      </PopRow>
      {!control && onAddControl ? <button type="button" className="sp-rb-btn" onClick={onAddControl}>Add Plan / Reforecast switch</button> : null}
    </>
  );
}

const projectionBasisWord = (basis) => ({
  im: 'Impressions', cl: 'Clicks', coViews: 'Views', sp: 'Spend',
}[basis] || basis);

/* ── the Axis row, and the grammar's own refusal ──────────────────────────── */

/**
 * Auto / Left / Right, with the axis rules of §5.1 surfaced LIVE: a side this series may
 * not sit on is disabled and says why, in the grammar's own words.
 *
 * It asks by TRYING: the candidate draft is judged by `validateReportDraft` — the same
 * `normReport` the server runs — and a problem that is new AND about this chart's series is
 * the answer. Comparing against the problems the draft already has is what keeps an
 * unrelated fault somewhere else in the widget from greying out an axis that is perfectly
 * legal.
 */
function AxisRow({ widget, view, series, onPick }) {
  const uid = useId();
  const options = useMemo(() => {
    // The panel outlived its view (removed under an open popover): `seriesAt` answers null,
    // `patchSeries` is a no-op on it, and nothing here could be refused anyway — said once,
    // rather than building `/spec/views/-1/series` and letting every refusal disappear
    // because it happens to match nothing.
    const at = seriesAt(widget.spec, view.id);
    if (at === null) return AXES.map((axis) => [axis, word(axis)]);
    // ONE baseline for the three questions — `askOn`, the shared module's own answer to the
    // cost of asking about several candidates at once (see `ask-grammar.js`).
    const ask = askOn(widget);
    return AXES.map((axis) => {
      if (axis === series.axis) return [axis, word(axis)];
      const why = ask({ ...widget, spec: patchSeries(widget.spec, view.id, series.id, { axis }) }, at);
      return why ? [axis, word(axis), why] : [axis, word(axis)];
    });
  }, [widget, view.id, series.id, series.axis]);
  // The refusal is PRINTED, not only hung on `title`: a tooltip is a reason only a mouse
  // can read. It already names both series — the grammar wrote it. Since T13 the refused
  // segment stays a Tab stop and points AT this sentence, so one node serves both readers.
  const why = options.map((o) => o[2]).find(Boolean) || null;
  return (
    <PopRow label="Axis" note={why} noteId={`${uid}-axis-why`}>
      <Seg label="Axis" value={series.axis} options={options} onPick={onPick} describedBy={`${uid}-axis-why`} />
    </PopRow>
  );
}

/* ── ▸ More ───────────────────────────────────────────────────────────────── */

/**
 * The drawing settings a reader needs less often.
 *
 * The Total row is ABSENT rather than refused for a value that cannot accumulate: a running
 * CTR is not a setting somebody nearly wanted, and §5.1 states the pair as count-and-money
 * only. The two halves of the grammar's rule are both read — a canonical metric is ONE
 * number for the whole flight, and a rate summed is a wrong number.
 */
function MoreRows({ spec, view, series, value, patch, patchThis, onStyle }) {
  const isCalc = series.kind === 'calc';
  const families = familyOf(value, spec);
  const canAccumulate = !isCalc && value && value.kind !== 'canonical'
    && families.length > 0 && families.every((f) => ADDITIVE_FAMILIES.includes(f))
    && !boundHoldsCanonical(value, spec);
  return (
    <>
      <StyleDetailRows style={series.style} onStyle={onStyle} />
      <PopRow label="Fill">
        <PaintSelect
          label="Fill" value={series.fill} allowNone
          onPick={(fill) => patchThis({ fill })}
        />
      </PopRow>
      <PopRow label="Border">
        <PaintSelect
          label="Border" value={series.border} allowNone
          onPick={(border) => patchThis({ border })}
        />
      </PopRow>
      <PopRow label="Dash">
        <Seg
          label="Dash" value={series.dashed}
          options={[[false, 'Off'], [true, 'Default'], ...DASH_PATTERNS.map((v) => [v, word(v)])]}
          onPick={(dashed) => patchThis({ dashed })}
        />
      </PopRow>
      <PopRow label="Opacity">
        <input
          type="number"
          className="sp-inp sp-inp--sm sp-rb-num"
          aria-label="Opacity"
          min={0}
          max={1}
          step={0.05}
          placeholder="Default"
          value={series.opacity == null ? '' : series.opacity}
          onChange={(e) => {
            const raw = String(e.target.value).trim();
            if (raw === '') { patchThis({ opacity: null }); return; }
            const opacity = Number(raw);
            if (Number.isFinite(opacity)) patchThis({ opacity });
          }}
        />
      </PopRow>
      <PopRow label="Values">
        <Seg
          label="Values" value={!!series.valuesOnChart} options={[[false, 'Off'], [true, 'On chart']]}
          onPick={(v) => patchThis({ valuesOnChart: v })}
        />
      </PopRow>
      {canAccumulate ? (
        <PopRow label="Total">
          <Seg
            label="Total" value={series.accumulate} options={ACCUMULATE_MODES.map((m) => [m, word(m)])}
            onPick={(m) => patchThis({ accumulate: m })}
          />
        </PopRow>
      ) : null}
      <PopRow label="Series">
        <Seg
          label="Series" value={!!series.hidden} options={[[false, 'Show'], [true, 'Hide']]}
          onPick={(h) => patchThis({ hidden: h })}
        />
      </PopRow>
      {/* WHERE this series sits — the order the legend and a stack are drawn in. Under
          `▸ More` because decision 17 puts it there; see `OrderRow` for why. */}
      <OrderRow
        list={arr(view.series)} id={series.id} label={seriesName(series, spec)}
        onMove={(dir) => patch((s) => moveSeries(s, view.id, series.id, dir))}
      />
    </>
  );
}

/** Guide label + placement are one atomic optional pair in the wire grammar. Replacing the
 * guide's value, inversion, label, or placement rebuilds from the complete current guide,
 * and clearing either label member clears both. */
export function guideWith(current, patch) {
  const cur = current || {};
  const next = { ...cur, ...patch, invert: patch.invert ?? !!cur.invert };
  for (const key of Object.keys(next)) if (next[key] == null) delete next[key];
  if (patch.value) {
    for (const key of ['calc', 'mode', 'modeControlId']) delete next[key];
  } else if (patch.calc) delete next.value;
  const label = Object.prototype.hasOwnProperty.call(patch, 'label') ? patch.label : cur.label;
  const placement = Object.prototype.hasOwnProperty.call(patch, 'labelPlacement')
    ? patch.labelPlacement : cur.labelPlacement;
  if (label != null && placement != null) {
    next.label = label;
    next.labelPlacement = placement;
  } else { delete next.label; delete next.labelPlacement; }
  return next;
}

/** The KIND half of the cumulative rule for a BOUND value: the switch can land on a
 *  canonical option, and a campaign total added to itself once per day draws a staircase
 *  describing nothing. `familyOf` cannot see it — `imprExpected` is a count. */
function boundHoldsCanonical(value, spec) {
  if (!value || value.kind !== 'bound') return false;
  const ctl = arr(spec && spec.controls).find((c) => c && c.type === 'metric');
  return arr(ctl && ctl.options).some((o) => o && o.value && o.value.kind === 'canonical');
}
