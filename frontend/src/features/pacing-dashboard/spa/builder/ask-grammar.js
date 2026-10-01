// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/ask-grammar.js
//
// «What would the grammar say if the author did this?» — asked by TRYING (widget-builder v2
// §1.1.3 + the P3 ruling that a refusal shown in the builder is the grammar's own sentence,
// verbatim, and never a second wording of it).
//
// A candidate draft is judged by `validateReportDraft` — the same `normReport` the server
// runs — and the answer is the first problem that is NEW and belongs to the element being
// asked about. Both halves matter:
//
//   NEW      a draft usually has faults elsewhere (a half filled switch, another card mid
//            edit). Without the diff, one of those would grey out an affordance that is
//            perfectly legal.
//   AT       a candidate can break something the pick was not about — adding a column can
//            trip the spec-wide value cap, which is a sentence about the WIDGET. Only
//            problems under the pointer being asked about answer this question.
//
// It is the idiom `SeriesPopover`'s Axis row was written in (T6), lifted into a module here
// because six doors ask the same question — the Axis row itself, the Δ% row of the table's
// `+ Add column` map, the ⇄ option of its second step, the Value select of a Δ% column's
// popover, the KPI panel's Δ-vs-other-source row, and the metric switch's option list. They
// all read this one now; the Axis row's inline twin is gone.
//
// WHAT IT CANNOT SEE. `normReport` answers with the FIRST problem and stops, so on a draft
// that already carries a fault the candidate answers with that same fault and the diff finds
// nothing new. `null` then means «cannot tell», and it reads BOTH ways:
//
//   ·  a refusal that is real goes UNSAID — silence, never a sentence about something else
//   ·  a caller reading `null` as «the grammar accepts this» OFFERS a pick it would refuse
//
// Nothing corrupts: such a draft is refused by name at the Save gate (§9, Fix or Undo). But
// an affordance whose own promise is on screen must not lean on this — decide that rule
// LOCALLY and let the sentence be the grammar's when the grammar could answer. `deltaItems`
// does it for the Δ% row's two facts, and `TableCard.addBoth` counts the column cap itself.
//
// COST. Each `refusalOn` runs `normReport` twice: once for the baseline, once for the
// candidate. A spec is small (six views, four series or twelve columns each) and these run
// per popover render, not per keystroke — but this is the most expensive thing on the card.
// A panel that asks about SEVERAL candidates at once (the Axis row asks about three sides,
// the metric switch about fifty-eight options) takes `askOn`, which computes the baseline
// once and then costs one run per question. That is the whole optimisation, and it is here
// rather than copied into each panel.
import { validateReportDraft } from '../report-draft.js';
import { walkViewNodes } from '../report-v2.js';

const key = (p) => `${p.pointer} ${p.detail}`;

/**
 * askOn(widget) → `(candidate, at) => detail|null` — `refusalOn` with the BASELINE computed
 * once, for a caller with more than one candidate to weigh.
 *
 * Same answer, same rules; the only difference is that the draft in hand is validated once
 * instead of once per question.
 */
export function askOn(widget) {
  const now = new Set(validateReportDraft(widget).problems.map(key));
  return (candidate, at) => {
    if (at == null) return null;
    const r = validateReportDraft(candidate);
    if (r.ok) return null;
    const hit = r.problems.find((p) => !now.has(key(p)) && (p.pointer === at || p.pointer.startsWith(`${at}/`)));
    return hit ? hit.detail : null;
  };
}

/**
 * refusalAt(widget, spec, at) → the grammar's own refusal sentence, or null.
 *
 *   widget  the draft as it stands — the baseline whose problems are already the author's
 *   spec    the candidate spec: this same widget with the edit applied
 *   at      a JSON-pointer PREFIX into the normalized widget (`/spec/views/1/columns`)
 *
 * `null` means «the grammar accepts this», which is the answer an affordance enables on.
 */
export function refusalAt(widget, spec, at) {
  return refusalOn(widget, { ...widget, spec }, at);
}

/**
 * refusalOn(widget, candidate, at) → the same answer for an edit that is NOT in the spec.
 *
 * The Data row's two chips need it: a widget's `scope` and its `datasetType` sit BESIDE the
 * spec, and three of the validator's rules read them. «May this report be given a scope
 * pin?» is a question about a candidate WIDGET, and building one is the only way to ask it
 * of the grammar rather than of a sentence typed twice.
 */
export function refusalOn(widget, candidate, at) {
  // A pointer of `null` is a view that is gone from under an open panel (see `columnsAt`):
  // the mutators are no-ops on it, so nothing could be refused anyway — and `askOn` would
  // still cost a baseline run to answer that.
  if (at == null) return null;
  return askOn(widget)(candidate, at);
}

/**
 * viewAt(spec, viewId) → the pointer prefix every refusal about ONE view starts with, or
 * `null` when that view is not in the spec.
 *
 * The null matters: the pointer is built from the view's INDEX, and `/spec/views/-1` would
 * silently match nothing — every refusal would vanish and every affordance would read as
 * legal on a card that is no longer there.
 *
 * A prefix, so it also covers the view's own children (`/spec/views/1/target`). That is
 * exactly what a KPI's Δ-vs-other-source row needs. Matching respects pointer segments:
 * a container can have children at both index 1 and index 10.
 */
export function viewAt(spec, viewId) {
  let at = null;
  walkViewNodes(spec?.views, (view, info) => {
    if (at === null && view?.id === viewId) at = `/spec/${info.path.join('/')}`;
  });
  return at;
}

/** …and the narrower one for a TABLE's columns, so a refusal about the view itself (the
 *  spec-wide value cap lands on the widget, but a row grain lands here) does not answer a
 *  question that was asked about one column. */
export function columnsAt(spec, viewId) {
  const at = viewAt(spec, viewId);
  return at === null ? null : `${at}/columns`;
}

/** …and its twin for a CHART's series, which the Axis row asks about: the axis rules are
 *  stated at the series that breaks them, and a refusal about the view itself is not an
 *  answer about where one line sits. */
export function seriesAt(spec, viewId) {
  const at = viewAt(spec, viewId);
  return at === null ? null : `${at}/series`;
}
