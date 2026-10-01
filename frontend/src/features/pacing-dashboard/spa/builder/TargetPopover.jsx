// Settings for a dependent target. Its owning KPI/column keeps the write rules,
// formula preview scope and storage; the target has no order or independent axis.
import { useMemo } from 'react';
import Popover from '../Popover.jsx';
import { TARGET_BANDS } from '../report-v2.js';
import { entryOf, familyOf } from '../metric-catalog.js';
import { datasetTypeOf } from '../report-draft.js';
import { formatsFor, formatWord } from './column-format.js';
import { sourceEnv, spotlightItems } from '../spotlight-items.js';
import { PopRow } from './rows.jsx';
import ValueRow, { SourceRow } from './ValueRow.jsx';

export default function TargetPopover({
  spec, target, ownerValue, kind = 'kpi', env = {}, anchorRef, valueRef,
  onValue, onChange, onFormula, onRemove, onClose,
}) {
  const totals = kind === 'table';
  const datasetType = datasetTypeOf(spec);
  const srcEnv = { ...sourceEnv(env), anchor: 'target' };
  const items = useMemo(() => spotlightItems('target', {
    ...sourceEnv(env), datasetType, grain: null, hasMetricControl: false,
    ...(!totals ? { targetFamily: familyOf(ownerValue, spec) } : null),
  }), [env.sourceFacts, env.mappings, env.availableMetrics, datasetType, totals, ownerValue, spec]);
  return (
    <Popover anchorRef={anchorRef} open onClose={onClose}
      title={totals ? 'Totals target settings' : 'Target settings'} initialFocus={valueRef}>
      <ValueRow spec={{ ...spec, controls: [] }} items={items} value={target.value}
        valueRef={valueRef} env={srcEnv} onPick={onValue} onFormula={onFormula} />
      <SourceRow value={target.value} entry={entryOf(target.value, datasetType)}
        datasetType={datasetType} env={srcEnv} onPick={onValue} />
      {totals ? (
        <PopRow label="Format">
          <select className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
            aria-label="Totals target format" value={target.format}
            onChange={(e) => onChange({ format: e.target.value })}>
            {formatsFor(target.value, spec, target.format, true).map((format) => (
              <option key={format} value={format}>{formatWord(format)}</option>
            ))}
          </select>
        </PopRow>
      ) : <>
        <PopRow label="Better value">
          <label className="sp-pop-ck">
            <input type="checkbox" aria-label="Lower is better" checked={!!target.invert}
              onChange={(e) => onChange({ invert: e.target.checked })} />
            {' Lower is better'}
          </label>
        </PopRow>
        <PopRow label="Alert band" note={target.invert ? 'Alert corridors require higher to be better.' : null}>
          <select className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
            aria-label="Target alert corridor" value={target.band || ''}
            onChange={(e) => onChange({ band: e.target.value || undefined })}>
            <option value="">None</option>
            {TARGET_BANDS.map((band) => (
              <option key={band} value={band} disabled={!!target.invert}>{band.toUpperCase()} corridor</option>
            ))}
          </select>
        </PopRow>
      </>}
      <button type="button" className="sp-pop-rm" onClick={onRemove}>
        {totals ? 'Remove totals target' : 'Remove target'}
      </button>
    </Popover>
  );
}
