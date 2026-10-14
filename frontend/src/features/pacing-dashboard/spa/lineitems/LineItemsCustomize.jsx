// workspace/src/pages/Dashboard/components/Settings/Widgets/LineItemsCustomize.jsx
// The Line Items card's "Customize" body (Line Items settings spec 2026-10-01, Part B):
// the column checklist in display order with ↑ ↓, the sort, the default view and the rows
// count. It edits ONE drawer-draft key, `display.lineItems`, through `onChange`: every write
// is the full four-key object (started from the defaults when the key is absent), and
// "Reset to default" writes null (the save path deletes the key). Opening it writes nothing.
// `value` is the draft's key (object | null | undefined); `hasConversions` greys the Conv
// column with its note on a pacing that has none. Styles: .lic-* in DisplaySettings.css.
import { useEffect, useState } from 'react';
import {
  COLUMNS, COLUMN_KEYS, MAX_COLUMNS, ROWS_MIN, ROWS_MAX, SORT_FIELDS, SORT_FIELD_LABELS, VIEWS,
  resolveLineItemSettings,
} from '../line-item-columns.js';

const LABEL = Object.fromEntries(COLUMNS.map((c) => [c.key, c.label]));
const VIEW_LABELS = { all: 'All lines', byChannel: 'By channel' };

export default function LineItemsCustomize({ value, onChange, hasConversions = true }) {
  const current = resolveLineItemSettings(value);
  const checked = current.columns;
  const unchecked = COLUMN_KEYS.filter((k) => !checked.includes(k));
  const others = checked.filter((k) => k !== 'conv').length;
  const full = checked.length >= MAX_COLUMNS;
  const write = (patch) => onChange({ ...current, ...patch });

  // The rows field keeps what is being typed; the draft takes only a whole number in range,
  // and a stray value snaps back to the stored one on blur (never written out of range).
  const [rowsText, setRowsText] = useState(String(current.rows));
  useEffect(() => { setRowsText(String(current.rows)); }, [current.rows]);
  const rowsOk = (n) => Number.isInteger(n) && n >= ROWS_MIN && n <= ROWS_MAX;
  const onRows = (text) => {
    setRowsText(text);
    const n = Number(text);
    if (text.trim() !== '' && rowsOk(n) && n !== current.rows) write({ rows: n });
  };
  const onRowsBlur = () => {
    const n = Number(rowsText);
    if (rowsText.trim() === '' || !rowsOk(n)) setRowsText(String(current.rows));
  };

  const toggle = (key) => {
    if (checked.includes(key)) {
      if (key !== 'conv' && others <= 1) return;          // the last real column stays
      write({ columns: checked.filter((k) => k !== key) });
    } else {
      if (full) return;                                   // eight at most
      write({ columns: [...checked, key] });
    }
  };
  const move = (key, dir) => {
    const i = checked.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= checked.length) return;
    const next = checked.slice();
    [next[i], next[j]] = [next[j], next[i]];
    write({ columns: next });
  };

  const row = (key, on) => {
    const lastReal = on && key !== 'conv' && others <= 1;
    const convOff = key === 'conv' && !hasConversions;
    const disabled = on ? lastReal : full;
    return (
      <li key={key} className={`lic-row${on ? '' : ' lic-row--off'}${convOff ? ' lic-row--muted' : ''}`}>
        <label className="sp-chk lic-chk" title={lastReal ? 'Keep at least one column' : full && !on ? `${MAX_COLUMNS} columns at most` : undefined}>
          <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(key)} />
          <span className="lic-label">{LABEL[key]}</span>
          {convOff && <span className="lic-note">no conversions on this pacing</span>}
        </label>
        {on && (
          <span className="lic-move">
            <button type="button" className="sp-btn sp-btn-s lic-btn" aria-label={`Move ${LABEL[key]} up`}
              disabled={checked.indexOf(key) === 0} onClick={() => move(key, -1)}>↑</button>
            <button type="button" className="sp-btn sp-btn-s lic-btn" aria-label={`Move ${LABEL[key]} down`}
              disabled={checked.indexOf(key) === checked.length - 1} onClick={() => move(key, 1)}>↓</button>
          </span>
        )}
      </li>
    );
  };

  return (
    <div className="lic">
      <div className="lic-hd">
        <span className="sp-lbl lic-lbl">Columns</span>
        <span className="lic-count">{checked.length} of {MAX_COLUMNS}</span>
      </div>
      <ul className="lic-list" aria-label="Columns">
        {checked.map((k) => row(k, true))}
        {unchecked.map((k) => row(k, false))}
      </ul>
      <div className="sp-card-fields lic-fields">
        <div className="sp-card-field lic-sort">
          <span className="sp-lbl">Sort by</span>
          <span className="lic-pair">
            <select className="sp-inp sp-inp--sans" aria-label="Sort by" value={current.sort.key}
              onChange={(e) => write({ sort: { ...current.sort, key: e.target.value } })}>
              {SORT_FIELDS.map((k) => <option key={k} value={k}>{SORT_FIELD_LABELS[k]}</option>)}
              {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select className="sp-inp sp-inp--sans" aria-label="Sort direction" value={current.sort.dir}
              onChange={(e) => write({ sort: { ...current.sort, dir: e.target.value } })}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </span>
        </div>
        <div className="sp-card-field">
          <span className="sp-lbl">Default view</span>
          <select className="sp-inp sp-inp--sans" aria-label="Default view" value={current.view}
            onChange={(e) => write({ view: e.target.value })}>
            {VIEWS.map((v) => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}
          </select>
        </div>
        <div className="sp-card-field">
          <span className="sp-lbl">Rows before Show all</span>
          <input type="number" className="sp-inp" aria-label="Rows before Show all" min={ROWS_MIN} max={ROWS_MAX} step={1}
            value={rowsText} onChange={(e) => onRows(e.target.value)} onBlur={onRowsBlur} />
        </div>
      </div>
      <div className="lic-foot">
        <button type="button" className="sp-tp-link lic-reset" onClick={() => onChange(null)}>Reset to default</button>
        <span className="blib-hint lic-hint">{"Saved with the drawer's Save."}</span>
      </div>
    </div>
  );
}
