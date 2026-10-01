// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/ColumnPopover.jsx
//
// ONE column's settings (widget-builder v2 §5.2, mockup §2): the panel a column row opens.
// The row is the thing, this is its settings — §1.1.5's one mental primitive, and the row
// stays legible without it (§3: popovers are for editing only).
//
// It is the table's twin of `SeriesPopover`, on the same three rules: every picker is filled
// from the grammar, every refusal is the grammar's own sentence, and nothing is written that
// the grammar does not have. What differs is that a column has TWO kinds (Table G):
//
//   a VALUE column   Value (⇄ / the catalog / a formula) · Source · Format · Label
//   a Δ% column      Value (⇄ / one of the three fields BOTH sources carry) · Format · Label
//
// A Δ% has no Source row and no ƒx door, and neither is an omission: it subtracts CM360 from
// delivery, so both sources ARE the column (decision 14 fixes the pair at CM vs BQ), and its
// value has to be a dual-source FIELD — `isDualSource` reads `kind === 'metric'`, so no
// expression can ever be one.
import { SwitchAction } from './ContextualSwitch.jsx';
import { useMemo, useState } from 'react';
import Popover from '../Popover.jsx';
import { FORMATS_BY_FAMILY, LIMITS } from '../report-v2.js';
import { entriesFor, entryOf, mintValue } from '../metric-catalog.js';
import { autoLabel, grainTypeOf, resolveValue } from '../report-render.js';
import { datasetTypeOf, moveColumn, patchColumn, removeColumn } from '../report-draft.js';
import { columnsAt, refusalAt } from './ask-grammar.js';
import { formatFor, formatForValue, formatsFor, formatWord } from './column-format.js';
import { columnName } from './view-text.js';
import { GROUP_LABEL, deltaMetricStep, sourceEnv, sourcesFor } from '../spotlight-items.js';
import { OrderRow, PopRow } from './rows.jsx';
import { FollowsNote, SourceRow } from './ValueRow.jsx';

const arr = (v) => (Array.isArray(v) ? v : []);
/** No store under this panel: cm stays unpickable, which is what it was before the pacing's
 *  own facts reached the builder. */
const EMPTY_ENV = {};
/** The switch option, first in the Value list when the widget has one. */
const BOUND_OPTION = 'Metric switch ⇄';

/**
 * ColumnPopover — the settings of one column.
 *
 *   widget      the whole draft widget; a Δ% asks the grammar what it thinks of a bound value
 *   view        the table this column belongs to
 *   column      the column itself
 *   anchorRef   the row this panel hangs from
 *   valueRef    where focus lands on open (§3: the Value select)
 *   patch       the builder's ONE write path, `(mutate) => …`
 *   onPickValue open the Spotlight on this column's value (the ƒx door)
 */
export default function ColumnPopover({
  widget, view, column, anchorRef, valueRef, env = EMPTY_ENV, patch, onPickValue, onPickTarget, onEditTarget, onClose, onMakeSwitchable,
}) {
  const [more, setMore] = useState(false);
  const spec = widget.spec;
  // The pacing's own half of a source verdict (spec 2026-08-25 §4), for the Value select's
  // re-mint and the Source row under it — the same env the card judged its map in.
  const srcEnv = { ...sourceEnv(env), anchor: 'table' };
  const isDelta = column.kind === 'delta';
  const value = column.value || null;
  const datasetType = datasetTypeOf(spec);
  const entry = entryOf(value, datasetType);
  const resolved = resolveValue(value, spec, null);

  const patchThis = (p) => patch((s) => patchColumn(s, view.id, column.id, p));
  /** A value change carries the format rule with it (§1.1.4) — see `column-format.js`. */
  const setValue = (next, from) => patchThis({ value: next, format: from ? formatFor(column.format, from) : formatForValue(column.format, next, spec, !isDelta) });

  return (
    <Popover
      anchorRef={anchorRef}
      open
      onClose={onClose}
      title={isDelta ? 'Δ% column' : 'Column settings'}
      initialFocus={valueRef}
    >
      {isDelta ? (
        <DeltaValueRow
          widget={widget} view={view} column={column} value={value}
          datasetType={datasetType} valueRef={valueRef} onPick={setValue}
        />
      ) : (
        <ValueRow
          spec={spec} view={view} column={column} entry={entry} value={value}
          datasetType={datasetType} valueRef={valueRef} env={srcEnv}
          onPick={setValue} onPickValue={onPickValue}
        />
      )}

      {!isDelta && onMakeSwitchable ? <SwitchAction env={env} widget={widget} slot={{viewId:view.id,kind:'column',elementId:column.id}} onClick={onMakeSwitchable} /> : null}

      {/* A Δ% has no Source row and that is not an omission: it subtracts CM360 from
          delivery, so both sources ARE the column (decision 14). */}
      {isDelta ? null : (
        <SourceRow
          value={value} entry={entry} datasetType={datasetType} env={srcEnv}
          onPick={(next) => patchThis({ value: next })}
        />
      )}

      <PopRow label="Format">
        <select
          className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
          aria-label="Format"
          value={column.format}
          onChange={(e) => patchThis({ format: e.target.value })}
        >
          {/* `auto` is legal on a table CELL and on no other slot — the one argument that
              differs between the three pickers that share this list (§5.2 against §5.3/§5.4). */}
          {(isDelta ? deltaFormats(column) : formatsFor(value, spec, column.format, true)).map((f) => (
            <option key={f} value={f}>{formatWord(f)}</option>
          ))}
        </select>
      </PopRow>

      <PopRow label="Label">
        <input
          type="text"
          className="sp-inp sp-inp--sm sp-inp--sans sp-pop-inp"
          aria-label="Label"
          maxLength={LIMITS.label}
          value={column.labelAuto ? '' : column.label}
          placeholder={autoLabel(resolved) || '—'}
          onChange={(e) => patchThis({ label: e.target.value.slice(0, LIMITS.label) })}
        />
      </PopRow>

      <PopRow label="Totals target">
        <button type="button" className="sp-pop-set" aria-label={column.target ? 'Edit totals target' : 'Set totals target'}
          onClick={column.target ? onEditTarget : onPickTarget}>
          {column.target ? 'Edit totals target' : 'Set totals target'}
        </button>
      </PopRow>

      <button type="button" className="sp-pop-more" aria-label="More column settings" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? '▾ Less' : '▸ More'}
      </button>
      {more ? <>
        <PopRow label="Empty">
          <label className="sp-pop-ck"><input type="checkbox" aria-label="Hide column when empty" checked={!!column.hideWhenEmpty}
            onChange={(e) => patchThis({ hideWhenEmpty: e.target.checked ? true : undefined })} /> Hide when empty</label>
        </PopRow>
        <PopRow label="Zeros">
          <label className="sp-pop-ck"><input type="checkbox" aria-label="Blank zeros" checked={column.zeroAs === 'blank'}
            onChange={(e) => patchThis({ zeroAs: e.target.checked ? 'blank' : undefined })} /> Show as empty</label>
        </PopRow>
        <PopRow label="Extremes">
          <label className="sp-pop-ck"><input type="checkbox" aria-label="Highlight highest and lowest" checked={!!column.highlightExtremes}
            onChange={(e) => patchThis({ highlightExtremes: e.target.checked ? true : undefined,
              highlightDirection: e.target.checked ? column.highlightDirection : undefined })} /> Highlight highest and lowest</label>
        </PopRow>
        {column.highlightExtremes && <PopRow label="Better value">
          <select className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel" aria-label="Highlight direction"
            value={column.highlightDirection || 'auto'}
            onChange={(e) => patchThis({ highlightDirection: e.target.value === 'auto' ? undefined : e.target.value })}>
            <option value="auto">Automatic</option>
            <option value="higher">Higher is better</option>
            <option value="lower">Lower is better</option>
          </select>
        </PopRow>}
      </> : null}

      <OrderRow
        list={arr(view.columns)} id={column.id} label={columnName(column, spec)}
        onMove={(dir) => patch((s) => moveColumn(s, view.id, column.id, dir))}
      />

      <button
        type="button"
        className="sp-pop-rm"
        onClick={() => { patch((s) => removeColumn(s, view.id, column.id)); onClose(); }}
      >
        Remove from table
      </button>
      <FollowsNote value={value} />
    </Popover>
  );
}

/* ── the Value row ────────────────────────────────────────────────────────── */

/**
 * What this column prints (§2). The switch comes first whenever the widget HAS one, then
 * the catalog in the map's own groups — every entry, with the ones that cannot be picked
 * here disabled AND carrying the reason (§1.1.3), because a picker that quietly shortened
 * its list is what makes people believe a metric does not exist.
 *
 * The catalog judges this slot as its `table` anchor: on a dimension grain some fields have
 * no per-dimension number at all, which is the one rule a column's value can trip.
 *
 * A FORMULA is not in the catalog and cannot be, so it shows as its own option and the ƒx
 * button beside the select is the way back to the editor that wrote it.
 */
function ValueRow({ spec, view, column, entry, value, datasetType, valueRef, env, onPick, onPickValue }) {
  const hasSwitch = arr(spec.controls).some((c) => c && c.type === 'metric');
  const isFormula = !!value && value.kind === 'formula';
  const judged = useMemo(() => entriesFor({
    datasetType,
    anchor: 'table',
    // The RESOLVED grain (M4): a control grain is judged as the dimension it resolves to,
    // the same read the card behind this panel makes for its own map.
    grain: grainTypeOf(view.rows),
    hasMetricControl: hasSwitch,
  }), [datasetType, view.rows, hasSwitch]);

  const groups = [];
  for (const row of judged) {
    const label = GROUP_LABEL[row.entry.group] || row.entry.group;
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, rows: [] });
    groups[groups.length - 1].rows.push(row);
  }

  const cur = value && value.kind === 'bound' ? 'bound' : (isFormula ? 'formula' : (entry && entry.id) || '');

  const onChange = (next) => {
    if (next === 'formula') return;   // the ƒx button owns that door
    // A bound value carries no ONE family, so the format is left as it is and the validator
    // names it if an option of the switch cannot print it.
    if (next === 'bound') { onPick({ kind: 'bound' }, null); return; }
    const picked = judged.find((r) => r.entry.id === next);
    if (!picked) return;
    // The source the column already reads, when the new metric is also read from it —
    // switching Impressions for Clicks on a CM360 widget must not move a column back to
    // the delivery side on its own.
    const sources = sourcesFor(picked.entry, { ...env, datasetType, held: value && value.source });
    const source = value && sources.includes(value.source) ? value.source : sources[0];
    onPick(mintValue(picked.entry, { source, datasetType }), picked.entry);
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

/**
 * A Δ%'s value: WHICH metric the two sides are compared on. Only the three fields both
 * sources carry can be one (`isDualSource`), so this list is short by the grammar's own
 * rule rather than by a filter — and the ⇄ option is judged by ASKING: every option of the
 * switch has to be dual-source too, and only the draft knows whether they are.
 */
function DeltaValueRow({ widget, view, column, value, datasetType, valueRef, onPick }) {
  const spec = widget.spec;
  const control = arr(spec.controls).find((c) => c && c.type === 'metric') || null;
  const options = useMemo(() => deltaMetricStep({
    metricControl: control,
    boundRefusal: control
      ? refusalAt(widget, patchColumn(spec, view.id, column.id, { value: { kind: 'bound' } }),
        columnsAt(spec, view.id))
      : null,
  }), [widget, spec, control, view.id, column.id]);

  const cur = value && value.kind === 'bound' ? 'bound' : (entryOf(value, datasetType) || {}).id || '';

  return (
    <PopRow label="Value">
      <select
        ref={valueRef}
        className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
        aria-label="Value"
        value={cur}
        onChange={(e) => {
          const opt = options.find((o) => o.id === e.target.value);
          if (!opt || opt.disabled) return;
          // The format does not follow this pick: a Δ% prints a percentage whatever it
          // compares, which is why `normColumn` judges its format against `percent` and
          // not against the value's own family.
          onPick(opt.bound ? { kind: 'bound' } : mintValue(opt.entry, { source: 'bq', datasetType }), null);
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={!!o.disabled}>
            {o.disabled && o.reason ? `${o.label} · ${o.reason}` : o.label}
          </option>
        ))}
      </select>
    </PopRow>
  );
}

/* ── the Δ%'s own format list ─────────────────────────────────────────────── */

/**
 * The formats a Δ% column may print: `percent`'s own three. The grammar also accepts `auto`
 * there, and this picker does not offer it — `fmtV2`'s `auto` prints a ratio as a bare
 * number, so a Δ% of 12.3 would read as «12.3» with no sign of being a percentage. That is
 * a wrong number rather than a wrong style. A column that already STORES `auto` still shows
 * it, because a picker must show what is stored.
 */
function deltaFormats(column) {
  return FORMATS_BY_FAMILY.percent.filter((f) => f !== 'auto' || column.format === 'auto');
}
