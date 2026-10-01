// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/PieValuePopover.jsx
//
// A pie's VALUE (widget-builder v2 §5.4, mockup §2): the panel the value chip opens. Three
// rows — what is cut into shares, where it is read from, and how a slice prints.
//
// It is the SLOT's panel and not the view's, which is why the pie's other two settings
// (Slice by, Top N) are chips on the card and not rows in here: they say what the pie is
// cut BY, and this says what is being cut. The mockup draws the same split.
//
// NO ƒx DOOR, and that is the one place this panel differs from its three twins. A pie's
// value may not be a formula at all: `normPieView` refuses one outright, because §7.1 does
// not parse the expression and a share that comes out negative is not a slice. A door that
// only ever led to a refusal would be worse than none — so it is absent, and the row SAYS
// why (§1.1.3: the reason is visible, or it is not a reason), rather than leaving a reader
// looking for the button the other panels have.
//
// The other three refusals a pie value can hit — a canonical metric, a CM360-fed one, and a
// non-additive family — are the catalog's, in the map that fills the select: every entry is
// listed, and the ones a pie cannot cut carry the sentence that says so.
import { SwitchAction } from './ContextualSwitch.jsx';
import { useMemo } from 'react';
import Popover from '../Popover.jsx';
import { entryOf } from '../metric-catalog.js';
import { datasetTypeOf, setViewFormat, setViewValue } from '../report-draft.js';
import { formatsFor, formatWord, pickViewValue } from './column-format.js';
import { sourceEnv, spotlightItems } from '../spotlight-items.js';
import { PopRow } from './rows.jsx';
import ValueRow, { FollowsNote, SourceRow } from './ValueRow.jsx';

const arr = (v) => (Array.isArray(v) ? v : []);
/** No store under this panel: cm stays unpickable, which is what it was before the pacing's
 *  own facts reached the builder. */
const EMPTY_ENV = {};
/** Why there is no ƒx door here — `normPieView`'s own rule, restated dash-free the way the
 *  catalog restates the refusals it shows in a map (§3's copy rule: `—` is this renderer's
 *  empty-cell placeholder and may not be spent on punctuation). */
const NO_FORMULA = 'A pie cuts a total into shares, so its value is a metric and not a formula.';

/**
 * PieValuePopover — the settings of the one value a pie cuts.
 *
 *   widget     the whole draft widget (the spec is read off it, like its three twins)
 *   view       the pie itself
 *   anchorRef  the chip this panel hangs from
 *   valueRef   where focus lands on open (§3: the Value select)
 *   patch      the builder's ONE write path, `(mutate) => …`
 */
export default function PieValuePopover({ widget, view, anchorRef, valueRef, env = EMPTY_ENV, patch, onClose, onMakeSwitchable }) {
  const spec = widget.spec;
  const value = view.value || null;
  const datasetType = datasetTypeOf(spec);
  const entry = entryOf(value, datasetType);

  // A pie refuses cm on EITHER dataset (the grammar's own pie rail), and `anchor: 'pie'` is
  // what says so to the source judgement — the map and the Source row under it read one env.
  const srcEnv = useMemo(() => ({ ...sourceEnv(env), anchor: 'pie' }), [env.sourceFacts, env.mappings, env.availableMetrics]);
  // The slice dimension itself, beside the grain TYPE below: a `ds:` slice is judged by its
  // source's own metric list and not the delivery inventory (metric-catalog's `grainKey`),
  // which is the rule report-render already applies to the same pie at render time. A slice
  // that follows the dimension switch names no key — the builder cannot know where the
  // viewer will land.
  const sliceKey = typeof view.sliceBy?.key === 'string' ? view.sliceBy.key : null;
  const items = useMemo(() => spotlightItems('pie', {
    ...srcEnv,
    datasetType,
    hasMetricControl: arr(spec.controls).some((c) => c && c.type === 'metric'),
    // A pie's value is computed per dimension BUCKET, which is the grain the catalog judges
    // its per-dimension rule on.
    grain: 'dim',
    grainKey: sliceKey,
  }), [srcEnv, datasetType, spec.controls, sliceKey]);

  /** A value change carries the format rule with it (§1.1.4) — see `column-format.js`. */
  const setValue = (next, from) => patch((s) => pickViewValue(s, view.id, next, from));

  const content = (
    <>
      <ValueRow
        spec={spec} items={items} value={value} valueRef={valueRef} env={srcEnv}
        note={NO_FORMULA} onFormula={null} onPick={setValue}
      />

      {onMakeSwitchable ? <SwitchAction env={env} widget={widget} slot={{viewId:view.id,kind:'value'}} onClick={onMakeSwitchable} /> : null}

      <SourceRow
        value={value} entry={entry} datasetType={datasetType} env={srcEnv}
        onPick={(next) => patch((p) => setViewValue(p, view.id, next))}
      />

      <PopRow label="Format">
        <select
          className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
          aria-label="Format"
          value={view.format}
          onChange={(e) => { const f = e.target.value; patch((s) => setViewFormat(s, view.id, f)); }}
        >
          {/* No `auto`: §5.4 says a pie names the format its slices print, exactly as §5.3
              says it of a KPI. */}
          {formatsFor(value, spec, view.format, false).map((f) => (
            <option key={f} value={f}>{formatWord(f)}</option>
          ))}
        </select>
      </PopRow>

      <FollowsNote value={value} />
    </>
  );
  return <Popover anchorRef={anchorRef} open onClose={onClose} title="Value" initialFocus={valueRef}>{content}</Popover>;
}
