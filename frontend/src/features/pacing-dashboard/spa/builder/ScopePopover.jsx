// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/ScopePopover.jsx
//
// The Data row's SCOPE (spec §0.8; widget-builder v2 §7.5): which slice of the pacing this
// Widget draws, when it does not follow the dashboard's own filters. Four pins — channels,
// line items, one dimension value, and the time pin — form the canonical scope envelope.
//
// It writes the WRAPPER and not the spec: `scope` sits beside `spec`, which is why this is
// the one panel in the builder whose `patch` is not `(spec) => spec`. The builder hands down
// `onScope(next)` and owns the spread (T5's rule 1: the wrapper is spread, never rebuilt).
//
// THE LISTS COME FROM THE PACING, AND FROM ONE PLACE. `lib/dashboard/scope-options.js`
// derives «which line items exist» for this canonical picker.
//
// WHICH DIMENSIONS ARE OFFERED, and why. The eleven `metric-catalog.js:DIM_KEYS` accepts in
// a scope pin, `channel` included — the list both validators judge against, so the picker is
// never shorter than the rule. A key this pacing carries no values for is LISTED with its
// reason (§1.1.3), and `channel` carries its own: it is a property of the line item, not a
// split of the facts, so a channel pin would match nothing and the Channels row above is
// where a channel is actually pinned.
//
// The 50-entry cap is on the CONTROL (`maxSelected`), not only in the refusal that follows:
// the server refuses the 51st, so the picker prevents it before Save.
import MultiSelect from '../MultiSelect.jsx';
import Popover from '../Popover.jsx';
import { dimKeyOptions } from '../scope-options.js';
import { PopRow, Seg } from './rows.jsx';

/** `widgets-validate.mjs`'s `LIMITS.scopeList`, mirrored by `report-draft.js`. Stated on the
 *  control so the 51st pick is refused here rather than by a save that bounces every widget
 *  in the drawer with it. */
const SCOPE_LIST_MAX = 50;
const ALL = 'All — follow global';
const NONE = '— none';
/** §0.8's canonical words for the time pin. */
const TIME = [['', 'Follow selected period'], ['absolute', 'Always current']];

/**
 * ScopePopover — what this widget is pinned to.
 *
 *   scope        the widget's stored scope, or null for «nothing pinned»
 *   options      `{channels, lis, dimValuesFor}` — what this pacing HAS (the seam's `env`)
 *   anchorRef    the chip this panel hangs from
 *   onScope      the builder's wrapper write path, `(nextScope) => …`
 *
 * Focus goes to the panel's FIRST control (the Popover's own default) rather than to a named
 * ref: the first control is the Channels picker, whose trigger is the focusable element, and
 * a ref on the wrapper around it would resolve to a `<span>` that cannot take focus.
 */
export default function ScopePopover({ scope, options, anchorRef, onScope, onClose }) {
  const s = scope || {};
  const dimValuesFor = (options && options.dimValuesFor) || (() => []);
  const dimKey = (s.dims && s.dims[0] && s.dims[0].key) || '';
  const dimValues = dimValuesFor(dimKey);
  // The whole scope, merged — the legacy block's own shape, so a widget edited in either
  // screen stores the same three keys. EVERY row writes through here, the time pin included:
  // a second path would mint a different object for a widget pinned only by its time, and
  // «what this panel stores» would depend on which row the author touched first.
  //
  // `time` is the one key with no null form — its default is not stored at all (§0.8) — so it
  // is decided rather than spread: what `next` says when it says anything, else what the
  // widget already carries.
  const set = (next) => {
    const time = Object.prototype.hasOwnProperty.call(next, 'time') ? next.time : s.time;
    const out = { channels: s.channels ?? null, lis: s.lis ?? null, dims: s.dims ?? null, ...next };
    if (time === 'absolute') out.time = 'absolute'; else delete out.time;
    onScope(out);
  };

  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} title="Scope" width={320}>
      <PopRow label="Channels">
        <MultiSelect
          selected={s.channels || []}
          onChange={(next) => set({ channels: next.length ? next : null })}
          emptyLabel={ALL}
          options={(options && options.channels) || []}
          width={200}
        />
      </PopRow>

      <PopRow label="Line items">
        <MultiSelect
          maxSelected={SCOPE_LIST_MAX}
          selected={s.lis || []}
          onChange={(next) => set({ lis: next.length ? next : null })}
          emptyLabel={ALL}
          options={(options && options.lis) || []}
          width={200}
        />
      </PopRow>

      <PopRow label="Dimension">
        <select
          className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
          aria-label="Dimension"
          value={dimKey}
          onChange={(e) => {
            const key = e.target.value;
            // The NEW key's own first value, never the previous key's (round 6.1): a pinned
            // dim with a value that key does not carry matches nothing, and the validator
            // refuses a blank one by name.
            set({ dims: key ? [{ key, value: (dimValuesFor(key)[0] || {}).value || '' }] : null });
          }}
        >
          <option value="">{NONE}</option>
          {/* Named, never keyed: the Rows / X / Slice-by picker in this same window prints
              `DIM_LABELS`, so a panel two rows above it saying `tactic` where that one says
              Funnel reads as two different settings — and nobody looking for Funnel finds it. */}
          {dimKeyOptions(dimValuesFor).map(({ key, label, reason }) => (
            <option key={key} value={key} disabled={!!reason && key !== dimKey}>
              {reason ? `${label} · ${reason}` : label}
            </option>
          ))}
        </select>
      </PopRow>

      {dimKey ? (
        <PopRow label="Value">
          <select
            className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
            aria-label="Dimension value"
            value={(s.dims && s.dims[0] && s.dims[0].value) || ''}
            onChange={(e) => { const value = e.target.value; set({ dims: [{ key: dimKey, value }] }); }}
          >
            {dimValues.length
              ? dimValues.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
              : <option value="">no values in data</option>}
          </select>
        </PopRow>
      ) : null}

      <PopRow
        label="Time"
        note="Always current opts this widget out of every period source, its own included."
      >
        <Seg
          label="Time"
          value={s.time === 'absolute' ? 'absolute' : ''}
          options={TIME}
          onPick={(v) => set({ time: v === 'absolute' ? 'absolute' : null })}
        />
      </PopRow>
    </Popover>
  );
}
