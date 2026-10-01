// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/draft-states.js
//
// The UI half of §9's ten draft states: what each of them SAYS, and what the Save-time
// prompt does about the one state that survives a save.
//
// `report-draft.js` decides WHICH state a draft is in (`draftState`) and which element a
// refusal belongs to (the `element` on every problem). None of that is words. This file is
// the words — and the two answers the drawer's prompt needs — kept pure and out of the
// component so every sentence below is pinned by a test rather than read off a screenshot.
//
// TWO RULES SHAPE ALL OF IT.
//
//   1. A REFUSAL IS THE GRAMMAR'S OWN SENTENCE, VERBATIM (the P3 ruling). `pausedSay` puts
//      the validator's `detail` on screen with its em dashes intact — the same sentence the
//      drawer's footer prints for the same draft. What this file adds is the NAME of the
//      element it is about, in the words the card beside it wears.
//   2. AN INSTRUCTION IS NOT A REFUSAL. §9's `incomplete` is a draft missing a PIECE, and
//      the reader needs the next step, not the rule they broke — «Add a view», not «a
//      widget draws at least one view». Those sentences are minted here, dash-free (the
//      copy rule keeps `—` for the empty cell), one per cause, in the order
//      `incompleteDraft` asks its own questions so the two can never disagree about which
//      piece is missing. Where this file has no better sentence than the grammar's,
//      `incompleteSay` answers null and the banner falls back to the paused one.
//
// It sits in the Builder folder rather than under `lib/` because it reads the names the
// CARDS print (`view-text.js`), and a lib module reaching up into `pages/` would be the
// wrong way round. The drawer imports the four Save-prompt exports from here for the same
// reason it imports the gallery: the prompt is about a builder draft.
import { isV2Widget, LIMITS, flattenViews } from '../report-v2.js';
import {
  boundElements, CONTROL_LABEL, removeSeries, skippedElements,
} from '../report-draft.js';
import { columnName, seriesName, valueName, viewName } from './view-text.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const viewsOf = (spec) => flattenViews(arr(spec && spec.views));
const controlsOf = (spec) => arr(spec && spec.controls);

/**
 * elementName(element, spec) → what a refusal's element is CALLED, or null.
 *
 * `element` is T2's routing — `{kind, viewId?, elementId?, controlType?}` — which is a
 * coarse hint plus two ids, deliberately: the pointer beside it is the exact address. This
 * resolves it to a NAME, and the name is the one already on screen: a series' row, a
 * column's row, a control's chip, a view card's heading.
 *
 * A control is asked FIRST, because a refusal about a switch option carries a `controlType`
 * and no view at all. `null` is a real answer — the widget's own profile, its datasetType
 * and the spec-wide caps belong to no element, and a banner that quoted a blank name would
 * be worse than one that just says the sentence.
 */
export function elementName(element, spec) {
  const e = isObj(element) ? element : {};
  if (e.controlType) {
    const c = controlsOf(spec).find((x) => isObj(x) && x.type === e.controlType);
    return (c && c.label) || CONTROL_LABEL[e.controlType] || null;
  }
  const view = viewsOf(spec).find((v) => isObj(v) && v.id === e.viewId) || null;
  if (!view) return null;
  const s = arr(view.series).find((x) => isObj(x) && x.id === e.elementId);
  if (s) return seriesName(s, spec);
  const c = arr(view.columns).find((x) => isObj(x) && x.id === e.elementId);
  if (c) return columnName(c, spec);
  // A KPI and a pie hold one value and no label of their own (Table D), so a refusal about
  // that slot is named by what is IN it — which is what the card's own row prints.
  if (e.kind === 'value' && isObj(view.value)) return valueName(view.value, spec);
  return viewName(view, spec);
}

/** A structurally invalid current draft stays visible; this says why Save is blocked. */
export function pausedSay(problem, spec) {
  const detail = (isObj(problem) && problem.detail) || '';
  const name = elementName(isObj(problem) ? problem.element : null, spec);
  return name ? `Save blocked on “${name}”: ${detail}` : `Save blocked: ${detail}`;
}

/**
 * §9's `incomplete`: which piece is missing, said as the next step.
 *
 * The order is `incompleteDraft`'s (report-draft.js): views first, each card in stored
 * order, then the controls, then the one dangling reference that is about the report as a
 * whole. Null where the missing piece is a CAP — «six views», «48 values» — because a cap
 * is not a piece anybody can see missing, and the grammar's own sentence for it already
 * says exactly what to remove.
 */
export function incompleteSay(spec) {
  const list = viewsOf(spec);
  if (!list.length) return 'Add a view';
  if (list.filter((v) => v && v.kind !== 'container' && v.kind !== 'atom').length > LIMITS.views) return null;
  for (const v of list) {
    if (!isObj(v)) continue;
    const nm = viewName(v, spec);
    if (v.kind === 'container' && !arr(v.children).length) return list.length === 1 ? 'Add an element' : `Add an element to “${nm}”`;
    if (v.kind === 'atom' && !isObj(v.brick)) return `Choose a block for “${nm}”`;
    if (v.kind === 'chart') {
      const series = arr(v.series);
      if (!series.length) return `Add a series to “${nm}”`;
      if (series.some((s) => isObj(s) && s.kind !== 'calc' && !isObj(s.value))) return `Pick a metric for “${nm}”`;
    }
    if (v.kind === 'table') {
      const cols = arr(v.columns);
      if (!cols.length) return `Add a column to “${nm}”`;
      if (cols.some((c) => isObj(c) && !isObj(c.value))) return `Pick a metric for “${nm}”`;
    }
    if ((v.kind === 'kpi' || v.kind === 'pie') && !isObj(v.value)) return `Pick a metric for “${nm}”`;
    if (v.kind === 'compare') {
      // §5.5: a comparison IS its two controls. Removing one is a question the Controls row
      // already asks by name, so the piece to put back is named the same way here.
      const has = (id, type) => controlsOf(spec).some((c) => isObj(c) && c.id === id && c.type === type);
      if (!has(v.metricControlId, 'metric')) return `Add a Metric switch back: “${nm}” names one`;
      if (!has(v.breakdownControlId, 'breakdown')) return `Add a Breakdown switch back: “${nm}” names one`;
    }
  }
  for (const c of controlsOf(spec)) {
    if (!isObj(c)) continue;
    // The floor is the grammar's (two options is what makes a switch a switch); the count
    // is not repeated here, because a switch with three options is not incomplete.
    if ((c.type === 'metric' || c.type === 'period') && arr(c.options).length < 2) {
      return `Give the “${c.label || CONTROL_LABEL[c.type] || 'switch'}” switch at least two options`;
    }
  }
  const bound = boundElements(spec);
  if (bound.length && !controlsOf(spec).some((c) => isObj(c) && c.type === 'metric')) {
    return `Add a Metric switch back: “${bound[0].label || 'one element'}” follows one`;
  }
  return null;
}

/**
 * «N elements no longer apply on this X: a, b» — the mockup's own sentence (§2.11), in the
 * dash-free form the copy rules ask for, counting itself in the singular.
 *
 * `where` is the CHIP the reader would press to put it back: a chart's grain is called `X`
 * on its card and a table's is called `Rows`, and a sentence pointing at a chip that is not
 * on the card is a sentence about nothing.
 */
const noLongerApply = (names, where) => {
  const n = names.length;
  return `${n} element${n === 1 ? '' : 's'} no longer appl${n === 1 ? 'ies' : 'y'} on ${where}: ${names.join(', ')}`;
};

/** §9's `contextConflict`, said about the grain that just moved. */
export const conflictSay = (names, grain) => noLongerApply(names, grain === 'rows' ? 'these rows' : 'this X');

/** The Save-time prompt's sentence. Always the chart's X: a skipped element is a Plan or
 *  Needed line, and those live on a chart (`skippedElements`). */
export const skippedPrompt = (names) => noLongerApply(names, 'this X');

/** §3's third state, at rest: stored, drawn with its reason on the card's own row, and
 *  named here so it is not a surprise at Save time. Never a refusal — Save is allowed. */
export const skipSay = (names) => `Skipped on this X: ${names.join(', ')}`;

/**
 * §9's `incomplete`, said IN the card — the other half of the banner above it.
 *
 * An element list with nothing in it is a step not taken, so the row where the elements
 * would be says the next one. It does not name the view the way the banner does: the reader
 * is looking at the card it belongs to, and a card that named itself would be talking about
 * somebody else's. The three are here rather than in the cards so the two halves of one
 * state are minted in one place and cannot drift into two voices.
 */
export const ADD_FIRST = {
  __proto__: null,
  view: 'Add a view to start this Widget',
  chart: 'Add a series to draw this chart',
  table: 'Add a column to fill this table',
};

/* ── what the Save-time prompt asks about, and what it does ───────────────── */

/**
 * skippedInDisplay(display, opened) → `[{ w, skipped }]` for every v2 widget the Save-time
 * prompt should ask about: one this drawer session TOUCHED, that would be stored with
 * stored-but-skipped elements in it.
 *
 * Read off the drawer's own `localDisplay`, which is the array the builder patches through
 * — the same one the Save gate judges one line above. A LINKED v2 instance carries no spec
 * and answers with nothing, which is right: its elements belong to the library entry, and a
 * settings save is not the editor of that.
 *
 * `opened` is the display as this session opened it (the drawer's Reset snapshot, re-taken
 * on open, on a Library re-base and after every save). A report nobody touched is not asked
 * about: one answer to this prompt DELETES report content, and a question that deletes has
 * to be provoked by the reader's own edit — renaming the campaign and pressing Save is not
 * one. Pass nothing and every widget is asked about, which is all a caller with no snapshot
 * honestly knows.
 *
 * This narrows §3's «Save with skipped elements present shows a prompt» by the one case its
 * own reason («they must not accumulate silently») does not cover: accumulation happens
 * through edits, and an untouched report accumulated nothing this session.
 */
export function skippedInDisplay(display, opened) {
  const before = isObj(opened)
    ? new Map(arr(opened.widgets).filter(isObj).map((w) => [w.id, JSON.stringify(w)]))
    : null;
  const out = [];
  for (const w of arr(display && display.widgets)) {
    if (!isV2Widget(w)) continue;
    // The same comparison the drawer's own dirty check makes (`normDisplay` serializes each
    // widget whole): an untouched widget is a structuredClone of the same object, so its key
    // order is the snapshot's and only a real edit can move the string.
    if (before && before.get(w.id) === JSON.stringify(w)) continue;
    const skipped = skippedElements(w.spec);
    if (skipped.length) out.push({ w, skipped });
  }
  return out;
}

/**
 * The views «Remove» cannot empty: `[{ w, view, kept }]`, in the prompt's own order.
 *
 * A chart with no series is not a draft the grammar stores, and the save the reader pressed
 * is the WHOLE drawer's — a display the server refuses takes the campaign name typed beside
 * it down with it, and the recovery is Reset. So the removal is per-view all-or-nothing: a
 * chart whose every series is on the list keeps all of them, and the prompt says so BEFORE
 * the answer rather than the server saying it after.
 *
 * This is the one authority for that rule — `dropSkipped` obeys it and `keptSay` reports it.
 */
function blockedViews(pending) {
  const out = [];
  for (const p of arr(pending)) {
    const w = isObj(p) ? p.w : null;
    if (!isObj(w)) continue;
    const list = arr(p.skipped);
    const done = new Set();
    for (const e of list) {
      if (!isObj(e) || done.has(e.viewId)) continue;
      done.add(e.viewId);
      const view = viewsOf(w.spec).find((v) => isObj(v) && v.id === e.viewId) || null;
      const kept = list.filter((x) => isObj(x) && x.viewId === e.viewId);
      if (view && arr(view.series).length <= kept.length) out.push({ w, spec: w.spec, view, kept });
    }
  }
  return out;
}

/** The grammar's own sentence for the draft `dropSkipped` refuses to produce (report-v2). */
const EMPTY_CHART = 'a chart draws at least one series';

/** What Remove will NOT take, and why — appended to the prompt's message, or null when it
 *  can take everything it names. The reason is the grammar's sentence, not a second one.
 *
 *  It reads `pending` alone: every widget it names is IN there (`skippedInDisplay` carries
 *  the widget beside its skipped list), so the display it was first written to take was a
 *  parameter that decided nothing. */
export function keptSay(pending) {
  const said = blockedViews(pending).map(({ spec, view, kept }) => (
    `“${viewName(view, spec)}” keeps ${kept.map((e) => `“${e.label}”`).join(', ')}: ${EMPTY_CHART}`
  ));
  return said.length ? said.join('. ') : null;
}

/**
 * dropSkipped(display, pending) → the same display with those elements deleted — the answer
 * «Remove».
 *
 * Through `removeSeries`, the draft layer's own mutator, so the widget that comes out is
 * assembled in the grammar's key order and is one the server stores. Everything the prompt
 * was not about — the other widgets, `liNames`, `widgetRanges` — comes back by IDENTITY, and
 * so does a widget whose whole list is blocked (see `blockedViews`).
 */
export function dropSkipped(display, pending) {
  const by = new Map(arr(pending).map((p) => [p.w && p.w.id, p.skipped]));
  const blocked = new Set(blockedViews(pending).map(({ w, view }) => `${w.id}\u0000${view.id}`));
  return {
    ...display,
    widgets: arr(display && display.widgets).map((w) => {
      const list = isObj(w) ? by.get(w.id) : null;
      if (!list) return w;
      const take = arr(list).filter((e) => isObj(e) && !blocked.has(`${w.id}\u0000${e.viewId}`));
      if (!take.length) return w;
      return { ...w, spec: take.reduce((s, e) => removeSeries(s, e.viewId, e.seriesId), w.spec) };
    }),
  };
}
