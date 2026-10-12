// Settings · Mapping · Display names (spec docs/2026-09-24-display-names.md).
//
// A pacing gives a raw conversion action or creative a readable name: The Trade Desk sends
// actions as "1", "2", "3", and here 1 becomes "Login Button". The screen lists the values
// the loaded data carries, highest volume first, with a name field beside each. Every
// decision is in lib/settings/value-labels-editor.js; this file renders.
//
// The drawer owns the draft (config.data.value_labels) and its dirty / Save / Reset, like
// every other Mapping editor. The names apply at display time after Save, so nothing here
// reads or writes the data rows.

import { useId, useMemo, useState } from 'react';
import { formatConversion } from './conversion-format.js';
import { fI } from './format.js';
import {
  FIELDS, FIELD_META, MAX_LABEL_LEN,
  valuesInData, editorRows, setLabel, labelProblem, togetherNote, matchesQuery, namedCounts,
} from './value-labels-editor.js';

const PAGE = 50;

function volumeText(field, row) {
  const n = field === 'conversion_action' ? formatConversion(row.volume) : fI(row.volume);
  const unit = FIELD_META[field].metric;
  return `${n} ${unit} · ${row.lis} ${row.lis === 1 ? 'line item' : 'line items'}`;
}

/** Why a field lists nothing: the data is not fetched, or it is fetched and empty. */
function emptyText(field, rows) {
  if (!Array.isArray(rows)) {
    return field === 'conversion_action'
      ? 'Conversion data is not loaded for this pacing. Turn on "Fetch conversions" in Settings → Data; the actions appear here after the next refresh.'
      : 'Creative data is not loaded for this pacing. Turn on "Fetch creatives" in Settings → Data; the creatives appear here after the next refresh.';
  }
  return field === 'conversion_action'
    ? 'The current data has no conversion actions.'
    : 'The current data has no creatives.';
}

function ValueRow({ field, row, onLabel }) {
  const problem = labelProblem(row.label);
  const note = togetherNote(row);
  // A raw value can hold spaces and any character, so it is never part of an id.
  const inputId = useId();
  return (
    <div className={`vl-row${problem ? ' vl-row--error' : ''}`}>
      <div className="vl-row-value">
        <strong title={row.raw}>{row.raw}</strong>
        <span>{volumeText(field, row)}</span>
      </div>
      <div className="vl-row-edit">
        <label className="sr-only" htmlFor={inputId}>Display name for {row.raw}</label>
        <input
          id={inputId}
          className="sp-inp"
          value={row.label}
          maxLength={MAX_LABEL_LEN}
          placeholder="Keep as is"
          aria-invalid={problem ? 'true' : undefined}
          onChange={(e) => onLabel(row.raw, e.target.value)}
        />
        {/* Always in the row, hidden while there is nothing to clear: appearing on the first
            keystroke it would narrow the field under the cursor and break the column edge. */}
        <button type="button" className={`am-text-button vl-clear${row.label === '' ? ' vl-clear--idle' : ''}`}
          disabled={row.label === ''} onClick={() => onLabel(row.raw, '')}
          aria-label={`Clear the display name for ${row.raw}`}>
          Clear
        </button>
      </div>
      {(problem || note) && (
        <p className={`vl-row-note${problem ? ' vl-row-note--error' : ''}`} role={problem ? 'alert' : undefined}>
          {problem || note}
        </p>
      )}
    </div>
  );
}

// SEAM: the SPA read these two off its own store. The Hub has no such store on this screen and
// already carries both on the dashboard payload, so they arrive as props instead. Two lines - the
// rest of this file is the reference's.
export default function DisplayNamesEditor({ valueLabels, onChange, conversions = [], creatives = [] }) {
  const rowsByField = { conversion_action: conversions, creative: creatives };

  const [field, setField] = useState(() => (
    !Array.isArray(conversions) && Array.isArray(creatives) ? 'creative' : 'conversion_action'));
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  const dataValues = useMemo(() => ({
    conversion_action: valuesInData('conversion_action', conversions),
    creative: valuesInData('creative', creatives),
  }), [conversions, creatives]);
  const { rows, orphans } = useMemo(
    () => editorRows(valueLabels, field, dataValues[field]),
    [valueLabels, field, dataValues],
  );
  const filtered = useMemo(() => rows.filter((r) => matchesQuery(r, query)), [rows, query]);
  const counts = namedCounts(valueLabels);
  const meta = FIELD_META[field];

  const onLabel = (raw, label) => onChange(setLabel(valueLabels, field, raw, label));
  const pickField = (f) => { if (f !== field) { setField(f); setQuery(''); setShown(PAGE); } };

  return (
    <div className="am-page vl-page">
      <header className="am-header">
        <div>
          <div className="am-eyebrow">Display names</div>
          <h3>Readable names for values</h3>
          <p>
            Give a conversion action or a creative a readable name. The pacing shows it everywhere after
            Save, the Google Sheet after the next refresh. Values with the same name show as one row.
          </p>
        </div>
      </header>

      <div className="mp3-rowtabs vl-tabs" role="tablist" aria-label="What to name">
        {FIELDS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={field === f}
            className={`mp3-rowtab${field === f ? ' on' : ''}`}
            onClick={() => pickField(f)}
          >
            {FIELD_META[f].title}
            {counts[f] > 0 && <span className="vl-tab-count"> · {counts[f]} named</span>}
          </button>
        ))}
      </div>

      <section className="am-section" aria-label={meta.title}>
        <div className="am-section-head">
          <div>
            <h4>{meta.title} in the current data</h4>
            <p>
              {rows.length > 0
                ? `${fI(rows.length)} ${rows.length === 1 ? meta.one : meta.many}, highest ${meta.metric} first. Leave a name empty to keep the raw value.`
                : emptyText(field, rowsByField[field])}
            </p>
          </div>
        </div>

        {rows.length > PAGE && (
          <div className="am-library-toolbar">
            <input
              className="sp-inp am-search"
              type="search"
              value={query}
              aria-label={`Find a ${meta.one} or its name`}
              placeholder={`Find a ${meta.one} or its name`}
              onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
            />
          </div>
        )}

        {rows.length > 0 && filtered.length === 0 && (
          <div className="am-empty">Nothing matches “{query.trim()}”.</div>
        )}

        {filtered.length > 0 && (
          <div className="vl-list">
            {filtered.slice(0, shown).map((r) => (
              <ValueRow key={r.raw} field={field} row={r} onLabel={onLabel} />
            ))}
          </div>
        )}

        {filtered.length > shown && (
          <div className="am-list-nav">
            <span>Showing {fI(Math.min(shown, filtered.length))} of {fI(filtered.length)}</span>
            <button type="button" className="sp-btn sp-btn-s" onClick={() => setShown((n) => n + PAGE)}>
              Show {fI(Math.min(PAGE, filtered.length - shown))} more
            </button>
          </div>
        )}
      </section>

      {orphans.length > 0 && (
        <section className="am-section" aria-label="Names for values not in the current data">
          <div className="am-section-head">
            <div>
              <h4>Not in the current data</h4>
              <p>
                These names are kept and apply again if the value comes back. Remove the ones you no
                longer need.
              </p>
            </div>
          </div>
          <div className="vl-list">
            {orphans.map((o) => (
              <div className="vl-row vl-row--orphan" key={o.raw}>
                <div className="vl-row-value">
                  <strong title={o.raw}>{o.raw}</strong>
                  <span>Named “{o.label.trim()}”</span>
                </div>
                <div className="vl-row-edit">
                  <button type="button" className="sp-btn sp-btn-s" onClick={() => onLabel(o.raw, '')}
                    aria-label={`Remove the display name for ${o.raw}`}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
