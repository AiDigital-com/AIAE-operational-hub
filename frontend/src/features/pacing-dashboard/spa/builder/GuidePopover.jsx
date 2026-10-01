import { useMemo, useState } from 'react';
import Popover from '../Popover.jsx';
import { DASH_PATTERNS, EXACT_STROKE_WIDTHS, GUIDE_LABEL_PLACEMENTS, LIMITS, STROKE_WIDTHS } from '../report-v2.js';
import { datasetTypeOf, patchSeries, setCalculatedGuideMode, setControl } from '../report-draft.js';
import { entryOf } from '../metric-catalog.js';
import { calculatedGuideLabel, grainTypeOf } from '../report-render.js';
import { sourceEnv, spotlightItems } from '../spotlight-items.js';
import { guideWith, StyleDetailRows } from './SeriesPopover.jsx';
import ValueRow, { SourceRow } from './ValueRow.jsx';
import { PaintSelect, PopRow, Seg, word } from './rows.jsx';

// The defaults of a new calculated Guide live beside the transaction that writes them
// (report-draft.js `addCalculatedGuide`); the name is kept for the tests and the card.
export { calculatedGuideDefaults as expectedGuide } from '../report-draft.js';

/** A guide owns its calculation or fixed value and its line appearance, and inherits its parent's axis. */
export default function GuidePopover({ widget, view, series, env = {}, anchorRef, valueRef, patch, onPickValue, onClose, onRemove }) {
  const spec = widget.spec;
  const guide = series.guide;
  const dynamic = !!guide.calc;
  const [more, setMore] = useState(false);
  const datasetType = datasetTypeOf(spec);
  const srcEnv = { ...sourceEnv(env), anchor: 'guide' };
  const items = useMemo(() => spotlightItems('guide', {
    ...sourceEnv(env), datasetType, grain: grainTypeOf(view.x), hasMetricControl: false,
  }).filter((item) => !item.id?.startsWith('guidecalc:') && item.g !== 'Calculated guide'), [env.sourceFacts, env.mappings, env.availableMetrics, datasetType, view.x]);
  const patchGuide = (fields) => patch((current) => patchSeries(current, view.id, series.id, {
    guide: guideWith(guide, fields),
  }));
  const line = guide.style || { type: 'line', width: 1.5, curve: 'smooth', points: false };
  // The mode is one choice: the viewer's Projection switch, or a fixed Plan / Reforecast.
  const control = spec.controls?.find((entry) => entry.type === 'projection') || null;
  const modeValue = guide.modeControlId ? 'control' : guide.mode === 'reforecast' ? 'reforecast' : 'plan';
  const addControl = () => patch((current) => {
    const next = setControl(current, { type: 'projection', label: 'Projection' });
    const added = next.controls.find((entry) => entry.type === 'projection');
    return patchSeries(next, view.id, series.id, { guide: guideWith(guide, { modeControlId: added.id, mode: null }) });
  });

  return <Popover anchorRef={anchorRef} open onClose={onClose} title="Guide settings" width={360} initialFocus={dynamic ? 'first' : valueRef}>
    {dynamic ? <>
      <PopRow label="Calculation">
        <button type="button" className="sp-inp sp-inp--sm sp-inp--sans sp-pop-inp" aria-label="Guide calculation" onClick={onPickValue}>{calculatedGuideLabel(guide, series.accumulate)}</button>
      </PopRow>
      {/* One patch: a fixed mode also retires a switch nothing else follows (report-draft.js
          `setCalculatedGuideMode`), so one Undo restores both the mode and the chip. */}
      <PopRow label="Mode" note={control ? 'Viewer switch: Plan first, Reforecast as their alternate.' : null}>
        <Seg label="Guide mode" value={modeValue}
          options={[['plan', 'Plan'], ['reforecast', 'Reforecast'], ...(control ? [['control', 'Viewer switch']] : [])]}
          onPick={(pick) => patch((current) => setCalculatedGuideMode(current, view.id, series.id, pick === 'control' ? control.id : pick))} />
      </PopRow>
      {!control ? <button type="button" className="sp-rb-btn" onClick={addControl}>Add Plan / Reforecast switch</button> : null}
    </> : <><ValueRow
      // Guides are fixed references: the generic value row must not offer a metric switch.
      spec={{ ...spec, controls: [] }} items={items} value={guide.value} valueRef={valueRef} env={srcEnv}
      onFormula={onPickValue} onPick={(value) => { if (value.kind !== 'bound') patchGuide({ value }); }}
    />
    <SourceRow value={guide.value} entry={entryOf(guide.value, datasetType)} datasetType={datasetType}
      env={srcEnv} onPick={(value) => patchGuide({ value })} /></>}
    {/* Appearance is offered on every guide: the chart draws colour, dash, width, opacity and
        the on-chart value for a fixed guide exactly as for a calculated one, and the grammar
        stores all five on both. The rows never write on their own; «Default» hands guideWith a
        null, which deletes the key, so a guide that was never styled keeps its exact bytes and
        the chart falls back to its own default. */}
    <PopRow label="Color"><PaintSelect label="Guide color" value={guide.color} allowNone onPick={(color) => patchGuide({ color })} /></PopRow>
    {/* «Lower is better» is a KPI-target reading; nothing on a chart reads it for a calculated
        Guide yet, so the control is offered only for a fixed reference (spec 2026-09-10). */}
    {dynamic ? null : <PopRow label="Direction">
      <label className="sp-pop-ck"><input type="checkbox" checked={!!guide.invert}
        onChange={(event) => patchGuide({ invert: event.target.checked })} />{' Lower is better'}</label>
    </PopRow>}
    <PopRow label="Guide label">
      <input type="text" className="sp-inp sp-inp--sm sp-inp--sans sp-pop-inp" aria-label="Guide label"
        maxLength={LIMITS.label} value={guide.label || ''} placeholder="Optional"
        onChange={(event) => {
          const label = event.target.value.slice(0, LIMITS.label);
          patchGuide(label.trim() ? { label, labelPlacement: guide.labelPlacement || 'legend' }
            : { label: null, labelPlacement: null });
        }} />
    </PopRow>
    {guide.label && <PopRow label="Placement">
      <Seg label="Guide label placement" value={guide.labelPlacement}
        options={GUIDE_LABEL_PLACEMENTS.map((placement) => [placement, placement === 'plotTopRight' ? 'Plot top right' : 'Legend'])}
        onPick={(labelPlacement) => patchGuide({ labelPlacement })} />
    </PopRow>}
    <button type="button" className="sp-pop-more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? '▾ Less' : '▸ More'}</button>
    {more ? <>
      {dynamic ? <StyleDetailRows style={line} onStyle={(fields) => patchGuide({ style: { ...line, ...fields, type: 'line' } })} />
        : <PopRow label="Width"><select className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel" aria-label="Width" value={line.width}
          onChange={(event) => patchGuide({ style: { ...line, width: STROKE_WIDTHS.includes(event.target.value) ? event.target.value : Number(event.target.value) } })}>
          {[...STROKE_WIDTHS, ...EXACT_STROKE_WIDTHS].map((width) => <option key={width} value={width}>{width}</option>)}
        </select></PopRow>}
      {/* «Default» on a fixed guide is the ABSENCE of the key (null, which guideWith deletes),
          and a stored `true` reads as the same answer: both draw the renderer's own pattern.
          The calculated model substitutes 'short' for a missing key (report-render.js), so
          there the segment keeps the stored `true` form. */}
      <PopRow label="Dash"><Seg label="Guide dash"
        value={dynamic ? (guide.dashed ?? 'short') : (guide.dashed === true || guide.dashed === undefined ? null : guide.dashed)}
        options={[[false, 'Off'], [dynamic ? true : null, 'Default'], ...DASH_PATTERNS.map((value) => [value, word(value)])]}
        onPick={(dashed) => patchGuide({ dashed })} /></PopRow>
      {/* Empty is «Default»: the key is deleted and the line draws opaque, the series
          popover's own opacity rule. */}
      <PopRow label="Opacity"><input type="number" className="sp-inp sp-inp--sm sp-pop-inp" aria-label="Guide opacity"
        min={0} max={1} step={0.05} placeholder="Default" value={guide.opacity == null ? '' : guide.opacity}
        onChange={(event) => {
          const raw = String(event.target.value).trim();
          if (raw === '') { patchGuide({ opacity: null }); return; }
          const value = Number(raw);
          if (Number.isFinite(value) && value >= 0 && value <= 1) patchGuide({ opacity: value });
        }} /></PopRow>
      <PopRow label="Values"><Seg label="Guide values" value={!!guide.valuesOnChart} options={[[false, 'Off'], [true, 'On chart']]}
        onPick={(valuesOnChart) => patchGuide({ valuesOnChart })} /></PopRow>
    </> : null}
    <button type="button" className="sp-pop-rm" onClick={onRemove}>Remove guide</button>
  </Popover>;
}
