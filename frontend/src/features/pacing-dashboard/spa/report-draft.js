// workspace/src/lib/dashboard/report-draft.js
//
// The DRAFT layer of the v2 builder (widget-builder v2 spec 2026-08-19 §3/§6/§9; P3 plan
// decision 4). Three things live here, and nothing else:
//
//   validateReportDraft(widget, env)  is this draft one the server would store, and if not,
//                                     WHICH element is the refusal about;
//   draftState(widget, env)           which of the ten states (§9) the builder is in, plus
//                                     the elements that are stored but skipped;
//   the mutators                      every edit the builder makes to a spec, as a pure
//                                     function that returns a NEW spec.
//
// No React, no DOM, no store: everything arrives as an argument, so the same functions serve
// the builder, the drawer's Save gate and a host test.
//
// THE VALIDATOR IS THE REAL GRAMMAR. It runs `normReport` — the same module dash-gate
// validates with — through the door, with a `ctx` whose two injected facts mirror the
// server's: `checkDimKey` is the catalog's mirror of widgets-validate's own rule, and
// `isCanonicalMetric` reads the shared canonical widget metric vocabulary. Around it come
// see from inside itself: the widget's outer SCOPE, which the same file judges on the way in
// (:339-368, for every widget), and the caller rules it applies around its own `normReport`
// call (:449-495). A client that refuses LESS lets the author press Save and read a 400; one
// that refuses MORE blocks a widget the server would have stored. Both are how a builder
// loses somebody's work, which is why `tests/report-draft-test.mjs` checks every refusal
// below against the real `validateDisplayPatch` on the same widget.
//
// NOTHING HERE CLAMPS OR COERCES (§9). A mutator writes what it is given; an illegal draft
// is REFUSED with its element named, never quietly repaired. The one thing the mutators do
// decide is stored ORDER — controls in CONTROL_TYPES order, period choices in PERIOD_CHOICES
// order — because that order is structural: a draft carrying the author's order would come
// back re-ordered from PG and read as dirty the moment it was saved.
import {
  LIMITS, POINTER_SEP, RANGE_VALUES, PERIOD_CHOICES, CONTROL_TYPES, WIDGET_PROFILES, LAYOUT_NO_SCOPE, isNodeId,
  normReport, normControls, derivedDatasetType, flattenViews, leafViews, walkViewNodes, specByteLimit,
} from './report-v2.js';
import {
  CATALOG, DIM_KEYS, DUAL_SOURCE_ENTRIES, checkDimKey, entryOf, mintValue,
} from './metric-catalog.js';
import { autoLabel, CALC_LABELS, CALC_SKIP_REASON, cmFeedOf, guideBasisOf, resolveValue } from './report-render.js';
import WidgetMetrics from '@shared/widget-metrics';
import FormulaChips from '@shared/formula-chips';
import { parse as parseFormula, validate as validateFormula, NO_CM_JOIN, PIE_NO_CM } from './widget-formula.js';
import { formulaScopeFor } from './formula-scope.js';
import { isCmBearing } from './cm-formula-context.js';
import { dimIsNamebuilder } from './widget-data.js';
import { isChipHolder } from './chips/info.js';
import { compileClient } from './chips/compile.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const arr = (v) => (Array.isArray(v) ? v : []);
/** The server quotes a rejected discriminator at 24 characters; so does this, or the two
 *  sentences differ on exactly the input that produced them. */
const cut = (v) => String(v).slice(0, 24);
/** The cap is stated in UTF-8 BYTES, and a spec is full of non-ASCII labels. `length` would
 *  count a Cyrillic label as half of what it stores. */
const utf8Bytes = (s) => new TextEncoder().encode(s).length;
/** The one metric a new view starts on — «Impressions», the field every pacing has. */
const DEFAULT_METRIC = CATALOG.find((e) => e.id === 'field:im');
/** A pie's default fold. Eight named slices is what the palette holds (COLOR_SLOTS), and a
 *  ninth colour repeats — so this is the largest pie that stays readable, not a guess. */
const DEFAULT_PIE_TOP_N = 8;
/**
 * The name each control is MINTED with. `normControl` refuses a blank label outright — a
 * control has no value to name itself from, unlike a series or a column — so every path
 * that creates one has to bring a word, and there is exactly one table of them.
 *
 * It lives HERE, beside the mutators, because `addView('compare')` mints two controls and
 * this module may not import a React component (see the file header). `ControlPopovers.jsx`
 * re-exports it for the panels that print it as a placeholder.
 */
export const CONTROL_LABEL = {
  __proto__: null,
  metric: 'Metric',
  period: 'Period',
  breakdown: 'Breakdown',
  // The words the legacy Breakdown panel's tab bar wears, so a viewer meets the question the
  // way this product has always asked it. «Breakdown» is taken by the CM360 control, which
  // asks a different question of a different dimension space.
  dimension: 'Break down by',
  projection: 'Projection',
};
/** How many mapping dimensions a Compare view's breakdown starts on. Two is what a
 *  comparison table reads at a glance — the mockup's own default, and what the CM360 panel
 *  one screen over opens on. The author moves it in the panel; nothing clamps it. */
const COMPARE_BREAKDOWN_MAX = 2;
/** §6's floor, restated: one option is a label, not a switch. The grammar keeps it private
 *  (MIN_SWITCH_OPTIONS); `draftState` needs it to tell an UNFINISHED switch from a broken
 *  one. The suite pins BOTH sides of the number against the real `normReport` — one option
 *  refused and read as unfinished, two accepted and read as finished — so a floor that moved
 *  fails there instead of quietly re-labelling a refused switch as complete. */
const MIN_SWITCH_OPTIONS = 2;
/** The scope-list cap `widgets-validate.mjs` applies to `channels` and `lis`
 *  (`LIMITS.scopeList`). Restated because it is a SERVER limit with no shared home; the
 *  parity case in the suite runs a 51-entry list through the real validator, so a cap that
 *  moved on the server fails there rather than at save time. */
const SCOPE_LIST_MAX = 50;
/** The caller rule the Data row's Scope chip prints when it is disabled — this module's
 *  own sentence, because this module is the client mirror of `widgets-validate.mjs` and the
 *  suite pins that mirror against the real server validator. It is a CONSTANT and not an
 *  answer from `validateReportDraft` for one reason: `normReport` is fail-fast and the caller
 *  rules run after it, so on a draft that is broken anywhere else the question cannot be
 *  asked — and a chip that is dimmed with no reason is not a reason (§1.1.3). */
export const CM_NO_SCOPE = 'a CM360 widget takes no widget scope; its rows come from the mapping';

/* ── validation ───────────────────────────────────────────────────────────── */

/**
 * The three facts `normReport` cannot reach from inside a dependency-free UMD, in the client's
 * own answer to each — the mirror of the adapter widgets-validate builds (:459-470).
 *
 * `env.dimSourceCatalog` is injectable so a test can exercise the strict half past today's
 * single built-in entry. The DRAWER passes none, and that is deliberate: the strict half
 * applies to CATALOGUED sources only, and a per-pacing source is judged on its shape alone —
 * refusing one here would fail EVERY settings save from that drawer the moment a source was
 * renamed (metric-catalog's `checkDimKey` carries the whole rule).
 *
 * Exported for the highlight editor and the Layout entries (formula chips P1-editor): each
 * normalises a rule or a block on its own, and without the same three facts a chip holder
 * is refused there with «no chip catalogue was injected», at Apply instead of at Save.
 */
export function draftCtx(env) {
  const catalog = env && env.dimSourceCatalog;
  return {
    checkDimKey: (where, key) => checkDimKey(where, key, catalog ? { catalog } : undefined),
    isCanonicalMetric: (k) => WidgetMetrics.WIDGET_METRICS.includes(k),
    // The third injected fact: the chip map a formula holder may carry (formula chips P0).
    normChips: (chips, expr, at, slot) => FormulaChips.norm(chips, expr, at, slot),
  };
}

/**
 * chipPlacement(scope, holder, join) → what `compileClient` judges a chip holder on (formula
 * chips P1-editor): the slot's grain, join and field set off its formula scope, and `cm`, the
 * TEXT rule compile.js reads — does the holder carry a `source: 'cm360'` chip (not
 * `isCmBearing`, which also answers for a matched BQ chip). `join` overrides the scope's join
 * where the slot's is not its grain's: a highlight's pair (`{cm, cmRefusal}`, an explicit
 * `cm: null` meaning «no join»). One residence for the three gates that build it — the draft
 * gate below, the highlight editor and the Layout entries — so they cannot drift apart.
 */
export function chipPlacement(scope, holder, join) {
  return {
    grain: scope.grain, role: 'row',
    cm: Object.values(holder.chips || {}).some((c) => c && c.source === 'cm360'),
    cmJoin: join && hasOwn(join, 'cm') ? join.cm : scope.cm,
    cmRefusal: join && join.cmRefusal ? join.cmRefusal : scope.cmRefusal,
    fieldSet: scope.fieldSet,
  };
}

/** The slot a pointer names, in compile.js's words; a bound option is judged by the slot of
 *  the element that consumes it, never by the switch. */
function slotOfPointer(pointer, consumer) {
  const p = consumer || pointer;
  if (/\/columns\/\d+\/target\/value$/.test(p)) return 'columnTarget';
  if (/\/target\/value$/.test(p)) return 'target';
  if (/\/guide\/value$/.test(p)) return 'guide';
  if (/\/columns\/\d+\/value$/.test(p)) return 'column';
  if (/\/series\/\d+\/value$/.test(p)) return 'series';
  if (/\/share\/value$/.test(p)) return 'share';
  if (/\/highlights\//.test(p)) return 'highlight';
  if (/\/controls\//.test(p)) return 'option';
  if (/\/brick\/|\/rows\/|\/badge\//.test(p)) return /series\/\d+$/.test(p) ? 'miniSeries' : 'bind';
  return 'value';
}

/**
 * validateReportDraft(widget, env) → `{ ok, normalized, problems, errors }`
 *
 *   normalized  the canonical-order spec the server would STORE, or null when the draft was
 *               refused (and on a linked instance, which carries none);
 *   problems    `[{ pointer, detail, element }]` — `pointer` is a JSON pointer into the
 *               normalized WIDGET (`/spec/views/0/series/1/value`, and `/scope`, `/profile`,
 *               `/datasetType` for the rules that live above the spec); `detail` is the
 *               grammar's own sentence with that pointer stripped off the front; `element` is
 *               the builder element the refusal belongs to (see `elementFor`);
 *   errors      the same list in the shape SettingsDrawer's footer already reads
 *               (`{where, error}` — it prints `v.errors[0].error` for the blocking widget).
 *
 * The GRAMMAR half is fail-fast, because `normReport` is: it returns one rejection, and the
 * next one only exists once that is fixed. So is the outer SCOPE half that runs before it
 * (`scopeProblem`), because the server refuses a scope without ever reading the spec. The
 * CALLER rules are all collected — they are independent statements about different chips, and
 * a builder that showed one at a time would send the author round the same loop three times.
 *
 * `widget` is the whole widget, not the spec: the scope block and four of the six rules read
 * `profile`, `scope` and `datasetType`, which sit beside the spec and not in it.
 */
export function validateReportDraft(widget, env) {
  const ctx = draftCtx(env);
  const problems = [];
  const push = (pointer, detail, spec) => {
    problems.push({ pointer, detail, element: elementFor(pointer, spec, ctx) });
  };
  // The server's own first sentence for one (`widget #0: not an object`). Answering "valid"
  // here would let the Save gate wave through a row that 400s the whole settings save.
  if (!isObj(widget)) {
    push('/', 'not an object', null);
    return done(problems, null);
  }

  // A LINKED instance carries no spec — the entry IS the definition, and widgets-validate
  // stops at the same place (`v2Branch` → 'linked'). Judged as an inline widget it would fail
  // on a spec it never had, and since the drawer sends the whole widgets array on every save,
  // one linked v2 tile would block EVERY save from that drawer.
  if (widget.lib !== undefined) {
    if (widget.spec === undefined) return done(problems, null);
    push('/lib', 'a linked instance carries no spec; the entry is the definition', null);
    return done(problems, null);
  }

  // The widget's OUTER scope, before anything under `spec` and before the profile — the
  // server's own order (:339, which runs for every widget on its way to :449).
  const sp = scopeProblem(widget);
  if (sp) {
    push(sp.pointer, sp.detail, widget.spec);
    return done(problems, null);
  }

  // The profile is checked BEFORE the spec, exactly where the server checks it (:449) — so a
  // doubly-wrong widget shows the same first refusal on both sides.
  if (!WIDGET_PROFILES.includes(widget.profile)) {
    push('/profile', `unknown composite profile "${cut(widget.profile)}"`, widget.spec);
  }

  const r = normReport(widget.spec, ctx);
  if (!r.ok) {
    const at = r.detail.indexOf(POINTER_SEP);
    // Every rejection out of the grammar opens with its pointer (`fail(at, detail)`); the
    // FIRST separator is the split, because a detail may well carry another one later on.
    // A pointer never carries one itself: every segment is a key or an index, and a node id
    // is `[a-z][a-z0-9_]*`, so nothing before the join can spell the separator.
    const pointer = at > 0 && r.detail.startsWith('/') ? r.detail.slice(0, at) : '/spec';
    push(pointer, at > 0 ? r.detail.slice(at + POINTER_SEP.length) : r.detail, widget.spec);
    return done(problems, null);
  }
  const out = r.out;
  const spec = widget.spec;

  // The five rules of widgets-validate.mjs:471-495, in its order, so `problems[0]` is the
  // sentence the server would have answered with.
  const derived = derivedDatasetType(out);
  if (widget.datasetType !== derived) {
    push('/datasetType', `datasetType "${cut(widget.datasetType)}" but the spec's dataset is "${derived}"`, spec);
  }
  if (derived === 'deliveryCm360') {
    // `!= null` is the server's own gate on reading a scope at all (:338): an EMPTY scope
    // object still normalizes into one, so `{}` is a scope for this rule too.
    if (widget.scope != null) {
      push('/scope', CM_NO_SCOPE, spec);
    }
    if (widget.profile !== 'section') {
      push('/profile', 'a CM360 widget uses the section profile', spec);
    }
  }
  if (widget.scope != null && widget.scope.time === 'absolute') {
    // §6 precedence: `absolute` opts the widget out of all three period sources, so both the
    // Period control and the Data period are dead config. The server throws once; the builder
    // has a chip for each, and each carries the sentence that names both.
    const detail = 'scope.time "absolute" opts this widget out of every period source; remove the Period control and the Data period';
    const i = out.controls.findIndex((c) => c.type === 'period');
    if (i !== -1) push(`/spec/controls/${i}`, detail, spec);
    if (out.period !== null) push('/spec/period', detail, spec);
  }
  const hasLayoutView = flattenViews(out.views).some((view) => view.kind === 'layout');
  if (hasLayoutView) {
    if (widget.scope != null) {
      push('/scope', LAYOUT_NO_SCOPE, spec);
    }
    if (widget.profile !== 'card' && widget.profile !== 'section') {
      push('/profile', `a Layout uses the card or section profile, not "${widget.profile}"`, spec);
    }
  }
  if (widget.profile !== 'section' && out.views.length !== 1) {
    const sizedProfile = widget.profile === 'card' ? 'a card' : `a ${widget.profile} profile`;
    push('/profile', `${sizedProfile} holds exactly one view (this one has ${out.views.length}); use the section profile`, spec);
  }
  // Weighed on the NORMALIZED spec, never on the draft: normDataset trims a fixed mapping id,
  // and an untrimmed one is unbounded — a draft of 60 KB stores as a few hundred bytes.
  const bytes = utf8Bytes(JSON.stringify(out));
  const byteLimit = specByteLimit(out);
  if (bytes > byteLimit) {
    push('/spec', `spec over ${byteLimit} bytes (${bytes})`, spec);
  }
  // Inspect the normalized tree so invalid formulas remain blocked after their
  // inspector closes. Bound options are checked in every slot that consumes them.
  const formulaProblems = new Set();
  const reportFormula = (pointer, error) => {
    const key = `${pointer}:${error}`;
    if (!formulaProblems.has(key)) { formulaProblems.add(key); push(pointer, error, spec); }
  };
  // `cmOverride` is `{cm, cmRefusal}` — the one family whose CM360 join is not its grain's
  // (§2.5): a highlight scoped `total`, and a pie's, which has no join at all. Everything
  // else leaves it null and the grain answers. It rides INTO the bound fan-out unchanged, so
  // a switch option is judged by the slot of every element bound to it and not by the switch,
  // which has no grain of its own.
  const check = (value, pointer, grain, consumer = null, cmOverride = null) => {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'bound') {
      out.controls.forEach((control, ci) => {
        if (control.type === 'metric') control.options.forEach((option, oi) => check(option.value, `/spec/controls/${ci}/options/${oi}/value`, grain, pointer, cmOverride));
      });
      return;
    }
    if (typeof value.expr !== 'string') return;
    // A stored formula may name the plan half of a DECLARED dimension (2026-09-12). WHICH
    // dimensions a pacing declares is a fact only a caller holding the pacing can supply, and
    // most callers here hold none — so where a plan could exist at all, an env that says
    // nothing is read as «it might», and the strict answer stays in the PICKER. A Save gate
    // that guessed «no» would block a widget the builder had just offered.
    //
    // But only where it COULD exist. A dimension source, an aux cut and `channel` can never
    // carry a declared target, and the renderer refuses a plan field on all three — so the
    // gate keeps refusing them too, which is what catches a plan formula left behind by a
    // Rows change from a namebuilder dimension to one of those.
    const scopeEnv = env && hasOwn(env, 'dimPlanEligible')
      ? env
      : { ...(env || {}), dimPlanEligible: grain?.type === 'control' || dimIsNamebuilder(grain?.key) };
    const scope = formulaScopeFor(grain, cmOverride ? { ...scopeEnv, ...cmOverride } : scopeEnv);
    if (isChipHolder(value)) {
      // A chip holder (formula chips P1-editor). The grammar has already checked the map's
      // shape; this is the client half of spec §3, the rules the server cannot know, each
      // refusal pointing at its chip so the editor outlines it, or at the expression when no
      // one chip is to blame (a window function on a grain with no days).
      const compiled = compileClient(value, chipPlacement(scope, value), slotOfPointer(pointer, consumer));
      if (!compiled.ok) for (const e of compiled.errors) reportFormula(e.ref ? `${pointer}/chips/${e.ref}` : `${pointer}/expr`, e.message);
      return;
    }
    // The SLOT decides whether a CM360 formula is legal here, and which sentence it is
    // refused with (§2.5). This is the only rail a stored cm-bearing formula passes: the
    // server validator parses no formula content, so a gate that guessed the join wrong
    // either blocks a widget the builder just offered or stores one the second pass has
    // nothing to join on.
    const parsed = validateFormula(value.expr, scope.contextKind, scope.fieldSet,
      { cm: scope.cm, cmRefusal: scope.cmRefusal });
    if (!parsed.ok) {
      const viewId = consumer && elementFor(consumer, out, ctx).viewId;
      const views = leafViews(out.views);
      const view = views.find((node) => node.id === viewId);
      const peers = view ? views.filter((node) => node.kind === view.kind) : [];
      const name = view && (view.title || `${KIND_WORD[view.kind] || view.kind}${peers.length > 1 ? ` ${peers.indexOf(view) + 1}` : ''}`);
      reportFormula(`${pointer}/expr`, name ? `${parsed.error} (used by “${name}”)` : parsed.error);
    }
  };
  /**
   * Which CM360 join one highlight half has (§2.8). The `{type:'agg'}` substitution below
   * decides the CONTEXT KIND and the field set only — a total rule is judged as an aggregate,
   * where window functions are illegal — while the JOIN is derived from the ORIGINAL grain,
   * the owner kind and the scope. Read off the substituted grain instead, a `total` rule on
   * `li` or `dateLi` rows would be admitted as a window, and the tile would then have no row
   * carrying a pair to sum. A pie never joins at all: `attachCmData` does not open one.
   */
  const alertCm = (ownerKind, grain, scope) => {
    if (ownerKind === 'pie') return { cm: null, cmRefusal: PIE_NO_CM };
    // No env, deliberately, where `check` passes one: the only thing read off this scope is
    // `.cm`, and the only env key that decides `.cm` is `cm` itself — the very override this
    // function exists to compute. Handing the module env in would let a caller's key answer
    // the join instead of the grain. Everything env changes (the field set, the labels, the
    // plan palette) belongs to the expression's own scope, which `check` builds for itself.
    const rows = formulaScopeFor(grain).cm;
    return { cm: scope === 'total' ? (rows ? 'total' : null) : rows, cmRefusal: NO_CM_JOIN };
  };
  const checkAlerts = (rules, pointer, grain, ownerKind) => {
    (rules || []).forEach((rule, i) => {
      const root = `${pointer}/${i}`;
      const context = rule.scope === 'total' ? { type: 'agg' } : grain;
      for (const [value, path] of [[rule.input, '/input'], [rule.guard, '/guard'],
        [rule.condition?.threshold, '/condition/threshold'], [rule.condition?.upper, '/condition/upper']]) {
        check(value, root + path, context, null, alertCm(ownerKind, grain, rule.scope));
        if (rule.scope === 'both') check(value, root + path, { type: 'agg' }, null, alertCm(ownerKind, grain, 'total'));
      }
    });
  };
  const aggregate = { type: 'agg' };
  const brickFormulas = (value, pointer, grain = aggregate) => {
    if (!value || typeof value !== 'object') return;
    const context = value.type === 'miniChart' ? { type: 'date' } : grain;
    check(value, pointer, context);
    for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') brickFormulas(child, `${pointer}/${key}`, context);
  };
  walkViewNodes(out.views, (view, info) => {
    const pointer = `/spec/${info.path.join('/')}`;
    if (view.kind === 'chart') view.series.forEach((series, i) => {
      check(series.value, `${pointer}/series/${i}/value`, view.x);
      check(series.guide?.value, `${pointer}/series/${i}/guide/value`, aggregate);
      checkAlerts(series.highlights, `${pointer}/series/${i}/highlights`, view.x, 'series');
    });
    if (view.kind === 'table') {
      view.columns.forEach((column, i) => {
        check(column.value, `${pointer}/columns/${i}/value`, view.rows);
        check(column.target?.value, `${pointer}/columns/${i}/target/value`, aggregate);
        checkAlerts(column.highlights, `${pointer}/columns/${i}/highlights`, view.rows, 'column');
      });
      check(view.share?.value, `${pointer}/share/value`, view.rows);
    }
    if (view.kind === 'kpi' || view.kind === 'pie') {
      check(view.value, `${pointer}/value`, aggregate);
      check(view.target?.value, `${pointer}/target/value`, aggregate);
      checkAlerts(view.highlights, `${pointer}/highlights`, view.kind === 'pie'
        ? (view.sliceBy?.controlId ? { type: 'control', controlId: view.sliceBy.controlId } : { type: 'dim', key: view.sliceBy?.key }) : aggregate,
      view.kind);
    }
    if (view.kind === 'atom') brickFormulas(view.brick, `${pointer}/brick`);
    if (view.kind === 'layout') brickFormulas(view.rows, `${pointer}/rows`);
    if (view.kind === 'container') brickFormulas(view.badge, `${pointer}/badge`);
  });
  // An unused switch option still needs syntactically valid text; the grammar
  // separately identifies an unreachable switch.
  out.controls.forEach((control, ci) => (control.options || []).forEach((option, oi) => {
    if (typeof option?.value?.expr !== 'string') return;
    const parsed = parseFormula(option.value.expr);
    if (!parsed.ok) reportFormula(`/spec/controls/${ci}/options/${oi}/value/expr`, parsed.error);
  }));
  return done(problems, out);
}

/**
 * The widget's OUTER scope, judged exactly as `widgets-validate.mjs:339-368` judges it — the
 * block that runs for EVERY widget, v2 included, on the way to the composite branch.
 *
 * It is here because the Save gate's v2 arm replaced `validateWidgetConfig`, whose scope half
 * (widget-data.js:1266-1288) is kind-blind and was the only thing reading these rules on a v2
 * widget. A client that reads only `scope.time === 'absolute'` waves a stored 51-channel pin
 * through to a 400 — and a 400 discards the WHOLE settings save, every other edit in the
 * drawer with it. The scope survives duplication and older writes, so it is reachable long
 * before the builder can edit one.
 *
 * FAIL-FAST, and before the spec, because the server is both: it throws on the scope without
 * ever looking at the spec, so the first sentence here is the one it would answer with.
 *
 * One rule is the CLIENT's own and the server has none: a pinned dim with an empty value
 * (round 6.1 — it matches nothing, and the server stores it happily). It is kept across the
 * arm switch because it is the same row and the same picker, and it says the same words the
 * legacy arm says. It runs after the server's own dim pass, so a scope the SERVER would
 * refuse still answers with the server's sentence.
 */
function scopeProblem(w) {
  const s = w.scope;
  if (s == null) return null;
  if (typeof s !== 'object') return { pointer: '/scope', detail: 'scope must be an object' };
  const dims = s.dims;
  if (dims != null) {
    if (!Array.isArray(dims) || dims.length > SCOPE_LIST_MAX) {
      return { pointer: '/scope/dims', detail: 'bad scope.dims' };
    }
    // Plain DIM_KEYS, never checkDimKey — the server's own note (:346): this is the scope
    // FILTER, it runs against factsDaily, and a `ds:` key here could only ever match nothing.
    for (let i = 0; i < dims.length; i++) {
      const d = dims[i];
      if (!d || !DIM_KEYS.includes(d.key)) {
        return { pointer: `/scope/dims/${i}`, detail: `unknown dim key "${d ? d.key : undefined}"` };
      }
    }
    for (let i = 0; i < dims.length; i++) {
      if (!String(dims[i].value ?? '').trim()) {
        return { pointer: `/scope/dims/${i}`, detail: `Pick a value for the "${dims[i].key}" dimension` };
      }
    }
  }
  for (const k of ['channels', 'lis']) {
    const v = s[k];
    if (v == null) continue;
    if (!Array.isArray(v)) return { pointer: `/scope/${k}`, detail: 'scope list must be an array or null' };
    if (v.length > SCOPE_LIST_MAX) {
      return { pointer: `/scope/${k}`, detail: `scope list over ${SCOPE_LIST_MAX} entries` };
    }
  }
  if (s.time != null && s.time !== 'global' && s.time !== 'absolute') {
    return { pointer: '/scope/time', detail: 'scope.time must be "global" or "absolute"' };
  }
  return null;
}

function done(problems, normalized) {
  return {
    ok: problems.length === 0,
    normalized: problems.length === 0 ? normalized : null,
    problems,
    // The drawer's footer lane. `where` is the pointer: it is the only locator that is exact
    // for every one of these, and the footer prints `error` alone.
    errors: problems.map((p) => ({ where: p.pointer, error: p.detail })),
  };
}

/**
 * Which BUILDER ELEMENT a pointer belongs to — `{kind, viewId?, elementId?, controlType?}`.
 *
 *   view / series / column   a view card, and a row inside it (`elementId` is the node id)
 *   control                  a chip in the Controls row (`controlType` says which one;
 *                            `elementId` is the control's id, or an OPTION's when the
 *                            pointer reaches one)
 *   value                    a value SLOT — any pointer ending in `/value`, wherever it
 *                            sits: a series, a column, a KPI, a guide, a switch option
 *   dataset                  the Data row: the dataset chip, the mapping, the Data period
 *                            and the widget's outer scope
 *   root                     the widget as a whole: its profile, its datasetType, the caps
 *
 * The `kind` is a coarse routing hint — the `pointer` beside it is the exact address, and a
 * card that wants the precise chip reads that.
 *
 * `/spec/controls/N` COUNTS TWO DIFFERENT LISTS, which is the whole reason this is not an
 * index lookup: a rejection raised INSIDE `normControls` counts the list the author sent,
 * while every one raised after it (reachability, the value walk, the caller rules) counts the
 * STORED order, `period, metric, breakdown`. Running `normControls` again answers which:
 * if it succeeds, the pointer is against its output; if it fails, the failing pointer is its
 * own. The element carries the control's TYPE either way, so the chip is found by type and
 * never by position.
 */
function elementFor(pointer, spec, ctx) {
  const parts = String(pointer).split('/').slice(1);
  if (parts[0] !== 'spec') return parts[0] === 'scope' ? { kind: 'dataset' } : { kind: 'root' };
  if (parts.length === 1) return { kind: 'root' };
  if (parts[1] === 'dataset' || parts[1] === 'period') return { kind: 'dataset' };
  if (parts[1] === 'controls') return controlElement(parts, spec, ctx);
  if (parts[1] === 'views') return viewElement(parts, spec);
  if (parts[1] === 'interactions') return interactionElement(parts, spec);
  return { kind: 'root' };
}

const endsInValue = (parts) => parts[parts.length - 1] === 'value';
const idx = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : -1;
};

function controlElement(parts, spec, ctx) {
  const i = idx(parts[2]);
  // `/spec/controls` with no index is the row itself — «a CM360 widget carries no period
  // control» is about the list, not about one chip.
  if (i === -1) return { kind: 'control' };
  const r = normControls(arr(spec && spec.controls), ctx);
  const list = r.ok ? r.out : arr(spec && spec.controls);
  const c = list[i];
  if (!isObj(c)) return { kind: 'control' };
  const el = { kind: endsInValue(parts) ? 'value' : 'control' };
  if (typeof c.type === 'string') el.controlType = c.type;
  if (typeof c.id === 'string') el.elementId = c.id;
  if (parts[3] === 'options') {
    const o = arr(c.options)[idx(parts[4])];
    if (isObj(o) && typeof o.id === 'string') el.elementId = o.id;
  }
  return el;
}

function viewElement(parts, spec) {
  // `/spec/views` with no index is the views column — «a widget draws at least one view».
  let v = arr(spec && spec.views)[idx(parts[2])];
  let offset = 3;
  while (isObj(v) && v.kind === 'container' && parts[offset] === 'children' && idx(parts[offset + 1]) >= 0) {
    v = arr(v.children)[idx(parts[offset + 1])];
    offset += 2;
  }
  if (!isObj(v)) return { kind: 'view' };
  const el = { kind: 'view' };
  if (typeof v.id === 'string') el.viewId = v.id;
  const slot = parts[offset] === 'series' || parts[offset] === 'columns' ? parts[offset] : null;
  if (slot) {
    const item = arr(v[slot])[idx(parts[offset + 1])];
    if (isObj(item)) {
      el.kind = slot === 'series' ? 'series' : 'column';
      if (typeof item.id === 'string') el.elementId = item.id;
    }
  }
  if (endsInValue(parts)) el.kind = 'value';
  return el;
}

function interactionElement(parts, spec) {
  const it = arr(spec && spec.interactions)[idx(parts[2])];
  if (!isObj(it)) return { kind: 'root' };
  // A wire is declared ON the view that fires it (§5.6: compare → chart), which is the card
  // the builder draws its chip on.
  const el = { kind: 'view' };
  if (typeof it.sourceViewId === 'string') el.viewId = it.sourceViewId;
  if (typeof it.id === 'string') el.elementId = it.id;
  return el;
}

/* ── the draft state machine (§9 + the §3 amendment) ──────────────────────── */

/**
 * draftState(widget, env) → `{ state, skipped }`
 *
 * `state` is one of the ten of §9. `env` is what only the BUILDER knows:
 *   validation      `validateReportDraft`'s result for this draft;
 *   preview         what the preview tile currently shows: `{zeroResult, sourceUnavailable}`;
 *   saving          a save is in flight;   saveError  the last save came back with one;
 *   dirty           the draft differs from what is stored;
 *   isNewborn       this widget has never been saved;
 *   contextChange   the edit that just landed changed a GRAIN or the dataset.
 *
 * `skipped` is the §3 amendment's third state — the calc series a non-date X has nothing to
 * stand on. They are STORED and drawn with their reason (the renderer's own sentence), they
 * never block Save, and they are what the Save-time «N elements no longer apply» prompt names.
 *
 * WHY `contextChange` IS AN INPUT. §9's own name for the state is «context conflict after
 * grain change»: it is a refusal plus a HISTORY, and the spec in hand carries no history — a
 * chart with `topN` on a date axis is the same draft whether the axis moved a second ago or a
 * month ago. So the builder, which made the edit, says so; without it the same draft reads as
 * `invalidLocal`, which shows the same refusal without the Undo.
 */
export function draftState(widget, env) {
  const o = isObj(env) ? env : {};
  const spec = isObj(widget) ? widget.spec : null;
  return { state: classify(spec, o), skipped: skippedElements(spec) };
}

function classify(spec, o) {
  // The two that describe the REQUEST, not the draft, and win over it: a save in flight
  // freezes the draft, and a save that came back with an error keeps it.
  if (o.saving) return 'saving';
  if (o.saveError) return 'saveError';
  if (o.validation && o.validation.ok === false) {
    if (o.contextChange) return 'contextConflict';
    return incompleteDraft(spec) ? 'incomplete' : 'invalidLocal';
  }
  // Both are answers about the DATA behind a valid draft, and both keep Save enabled (§9), so
  // they are read before the dirty axis: «no rows in this range» is what the author needs to
  // see, and «unsaved changes» is already on the footer. A missing source wins over an empty
  // result — it is the recoverable one, and it explains the emptiness.
  const p = isObj(o.preview) ? o.preview : null;
  if (p && p.sourceUnavailable) return 'sourceUnavailable';
  if (p && p.zeroResult) return 'zeroResult';
  if (o.isNewborn) return 'newValid';
  return o.dirty ? 'validDirty' : 'validClean';
}

/**
 * Is this draft missing a PIECE, rather than carrying a broken one (§9: «fewer than one View
 * or Measure, an empty required Series/Column slot, a dangling required reference, or a cap
 * violation»)? The difference is what the banner says: «Add a view» / «Choose a measure»
 * against «paused — fix the named element».
 *
 * Read off the DRAFT and not off the refusal, so it never depends on a sentence's wording.
 *
 * The two spec-WIDE caps — the 48 values and the 48 KB — are deliberately NOT here. Both need
 * the grammar's own walk over seven value slots, and a second walk would be one to drift from;
 * neither is a piece the reader can see missing, so they read as `invalidLocal` with their own
 * sentence, which says exactly what to remove.
 */
function incompleteDraft(spec) {
  if (!isObj(spec)) return true;
  const viewList = flattenViews(arr(spec.views));
  if (!viewList.length || leafViews(arr(spec.views)).filter((v) => v?.kind !== 'atom').length > LIMITS.views) return true;
  const controlList = arr(spec.controls);
  for (const v of viewList) {
    if (!isObj(v)) return true;
    if (v.kind === 'container' && !arr(v.children).length) return true;
    if (v.kind === 'atom' && !isObj(v.brick)) return true;
    if (v.kind === 'chart') {
      const list = arr(v.series);
      if (!list.length || list.length > LIMITS.series) return true;
      // An empty required slot: a value series with nothing in it yet.
      if (list.some((s) => isObj(s) && s.kind !== 'calc' && !isObj(s.value))) return true;
    }
    if (v.kind === 'table') {
      const list = arr(v.columns);
      if (!list.length || list.length > LIMITS.columns) return true;
      if (list.some((c) => isObj(c) && !isObj(c.value))) return true;
    }
    if ((v.kind === 'kpi' || v.kind === 'pie') && !isObj(v.value)) return true;
    if (v.kind === 'compare') {
      // A dangling required reference: the card names two controls, and one of them is gone.
      if (!controlList.some((c) => isObj(c) && c.id === v.metricControlId && c.type === 'metric')) return true;
      if (!controlList.some((c) => isObj(c) && c.id === v.breakdownControlId && c.type === 'breakdown')) return true;
    }
  }
  if (controlList.length > LIMITS.controls) return true;
  let hasMetricControl = false;
  let hasDimControl = false;
  for (const c of controlList) {
    if (!isObj(c)) return true;
    if (c.type === 'metric') hasMetricControl = true;
    if (c.type === 'dimension') hasDimControl = true;
    // An auto dimension switch has no stored list to count: it is complete by construction,
    // and the list it offers is the pacing's, resolved at render.
    if (c.type === 'dimension' && c.optionsAuto === true) continue;
    if (c.type === 'metric' || c.type === 'period' || c.type === 'dimension') {
      const n = arr(c.options).length;
      if (n < MIN_SWITCH_OPTIONS) return true;
      if (c.type === 'metric' && n > LIMITS.metricOptions) return true;
    }
  }
  // A bound element with no switch to follow is the other dangling reference (§2: `bound`
  // names no control because there is at most one). A control-bound GRAIN is the same
  // dangling reference one slot over.
  if (!hasMetricControl && hasBoundValue(viewList)) return true;
  if (!hasDimControl && dimensionGrains(spec).length) return true;
  const wires = arr(spec.interactions);
  if (wires.length > LIMITS.interactions) return true;
  for (const it of wires) {
    if (!isObj(it)) return true;
    if (!viewList.some((v) => isObj(v) && v.id === it.sourceViewId)) return true;
    if (!viewList.some((v) => isObj(v) && v.id === it.targetViewId)) return true;
  }
  return false;
}

const isBound = (v) => isObj(v) && v.kind === 'bound';

function hasBoundValue(viewList) {
  for (const v of viewList) {
    if (!isObj(v)) continue;
    for (const s of arr(v.series)) {
      if (isObj(s) && (isBound(s.value) || (isObj(s.guide) && isBound(s.guide.value)))) return true;
    }
    for (const c of arr(v.columns)) if (isObj(c) && isBound(c.value)) return true;
    if (isObj(v.share) && isBound(v.share.value)) return true;
    if (isBound(v.value)) return true;
    if (isObj(v.target) && isBound(v.target.value)) return true;
  }
  return false;
}

/**
 * The stored-but-skipped elements (§3 amendment): a Plan/Needed line off the date axis. Read
 * exactly as `buildReportChartModel` reads it — same axis test, same label, same sentence, and
 * a HIDDEN series is absent rather than skipped (the tile draws no note for one either).
 *
 * Exported for the drawer's Save-time prompt, which asks this ONE question of every widget in
 * the display and nothing else: `draftState` would walk the whole state machine per widget for
 * a list it already has here.
 */
export function skippedElements(spec) {
  const out = [];
  for (const v of flattenViews(arr(spec && spec.views))) {
    if (!isObj(v) || v.kind !== 'chart') continue;
    // A CONTROL axis is a dimension axis at render time (report-render's `resolveGrain`), so
    // §3's amendment reads it as one: a Plan/Needed line is skipped there too.
    const t = isObj(v.x) ? v.x.type : null;
    if (t !== 'li' && t !== 'dim' && t !== 'control') continue;
    for (const s of arr(v.series)) {
      if (!isObj(s) || s.kind !== 'calc' || s.hidden) continue;
      out.push({
        viewId: v.id,
        seriesId: s.id,
        label: s.labelAuto ? (CALC_LABELS[s.calc] || s.calc) : s.label,
        reason: CALC_SKIP_REASON,
      });
    }
  }
  return out;
}

/** Which slot carries a view's GRAIN — the one setting whose change re-reads every element
 *  on the card (§5.1 for a chart, §5.2 for a table). No other kind has one. */
const GRAIN_SLOT = { __proto__: null, chart: 'x', table: 'rows' };
/** A grain is `{type}`, `{type, key}` or `{type:'control', controlId}` and nothing else, so
 *  this is the whole comparison. A NUL join, because a dimension key is free text and
 *  `date` + `x` must not read as `dateX` + nothing — and the controlId takes a field of its
 *  own so two control grains naming different switches can never read as one. */
const grainKey = (g) => (isObj(g)
  ? `${g.type}\u0000${g.key == null ? '' : g.key}\u0000${g.controlId == null ? '' : g.controlId}`
  : '');

function grainMoved(prevSpec, nextSpec) {
  const before = flattenViews(arr(prevSpec && prevSpec.views));
  for (const v of flattenViews(arr(nextSpec && nextSpec.views))) {
    if (!isObj(v)) continue;
    const slot = GRAIN_SLOT[v.kind];
    if (!slot) continue;
    // BY ID, never by position: a removed view above this one would otherwise read as
    // every card below it changing grain at once.
    const had = before.find((x) => isObj(x) && x.id === v.id);
    if (!had || had.kind !== v.kind) continue;
    if (grainKey(had[slot]) !== grainKey(v[slot])) return { grain: slot, viewId: v.id };
  }
  return null;
}

const skipKey = (s) => `${s.viewId}\u0000${s.seriesId}`;

/**
 * contextDiff(prev, next) → `{ grain, viewId, skipped, broken }`, or null.
 *
 * The one thing `draftState` cannot read off a spec: §9's context conflict is a refusal
 * plus a HISTORY — «this edit did that» — and the only place that history exists is the
 * edit itself. So the builder asks this of the two drafts its own patch just produced, and
 * hands the answer back to `draftState` as `contextChange` (see that function's WHY note).
 *
 *   grain    `'x'` (a chart) or `'rows'` (a table) — which slot moved, and the word the
 *            card beside it wears, so the banner names the chip the reader would press
 *   skipped  the calculations that were NOT skipped before this edit and are now (§3's
 *            third state): stored, drawn with their reason, and never a blocker
 *   broken   the grammar's own problems, in full — `{pointer, detail, element}` — for a
 *            draft that WAS storable and now is not
 *
 * `broken` is `ok → not ok` and nothing looser. A draft that was already refused answers
 * with the fault it already had, and an Undo offered for THAT would restore a grain that
 * fixes nothing — so such an edit reports no conflict and the draft reads as `invalidLocal`,
 * which is what it is (`ask-grammar.js` documents the same «cannot tell» limit one layer up).
 *
 * PURE, and cheap enough to run on every patch: one grain walk plus, only when a grain
 * actually moved, two `normReport` runs.
 */
export function contextDiff(prev, next) {
  const at = grainMoved(isObj(prev) ? prev.spec : null, isObj(next) ? next.spec : null);
  if (!at) return null;
  const was = new Set(skippedElements(prev.spec).map(skipKey));
  const skipped = skippedElements(next.spec).filter((s) => !was.has(skipKey(s)));
  // Every problem of a draft that was storable a moment ago is one this edit made, so
  // there is nothing to diff — which is also why this reads the whole list and not the first.
  const broken = validateReportDraft(prev).ok ? validateReportDraft(next).problems : [];
  return (skipped.length || broken.length) ? { ...at, skipped, broken } : null;
}

/* ── the mutators ─────────────────────────────────────────────────────────── */
//
// Every one of them takes a spec and returns a NEW spec, touching nothing but the branch it
// is about — an untouched `controls` array comes back by IDENTITY, so React skips what did
// not change. An id that names nothing (a popover still open on a series another action just
// removed) is a NO-OP that returns the SAME spec: a throw there would take the drawer down
// for a stale reference.
//
// They assemble in the grammar's KEY ORDER, because the stored JSON is byte-compared — by the
// goldens, and by the drawer's dirty check. A key the grammar does not have is not carried.

const pick = (o, k, d) => (isObj(o) && hasOwn(o, k) ? o[k] : d);
const views = (spec) => arr(spec && spec.views);
const controls = (spec) => arr(spec && spec.controls);
/** The draft's dataset type, for `mintValue`. It reads the ONE place the fact is stored
 *  through the grammar's own accessor rather than reaching into the shape — but that accessor
 *  is not a guard (its docblock: on a malformed spec `spec.dataset.type` THROWS), and a
 *  mid-edit draft is exactly where a mutator meets one. Anything that is not the CM360 word
 *  reads as `delivery`, because `mintValue` refuses a third word and a mutator must not throw
 *  where the validator names the fault. */
export const datasetTypeOf = (spec) => (isObj(spec) && isObj(spec.dataset)
  && derivedDatasetType(spec) === 'deliveryCm360' ? 'deliveryCm360' : 'delivery');
/**
 * Replace one view by id, or hand the same spec back when nothing matched.
 *
 * `kind` is optional and it is a GATE: a mutator that writes a kind-specific key
 * (`series`, `columns`, `x`, `rows`, `sliceBy`) must not write it onto a card that has no
 * such slot — the draft would fail with «unknown key» instead of the mutator being the
 * documented no-op for a slot the builder never offers there. The patch/remove/move
 * mutators need no gate: they resolve an element BY ID inside the slot, and a table holds
 * no series to find.
 *
 * It takes a LIST of kinds as well as one, because two keys are shared by exactly two
 * kinds: a KPI and a pie each hold one `value` and one `format` (Table D), and gating those
 * on one kind at a time would be two mutators writing the same key.
 */
/** Immutable recursive mapping; returning null removes a node and its subtree. */
function mapViewTree(list, make, depth = 1) {
  if (depth > LIMITS.compositionDepth) return list;
  let changed = false;
  const next = [];
  for (const node of arr(list)) {
    let value = make(node);
    if (value == null && node != null) { changed = true; continue; }
    if (isObj(value) && value.kind === 'container') {
      const children = mapViewTree(arr(value.children), make, depth + 1);
      if (children !== value.children) value = { ...value, children };
    }
    if (value !== node) changed = true;
    next.push(value);
  }
  return changed ? next : list;
}
function withView(spec, viewId, make, kind) {
  const list = views(spec);
  const next = mapViewTree(list, (v) => {
    const matches = !kind || (Array.isArray(kind) ? kind.includes(v?.kind) : v?.kind === kind);
    return isObj(v) && v.id === viewId && matches ? make(v) : v;
  });
  return next === list ? spec : { ...spec, views: next };
}
/** Shared immutable edit path for node-specific inspectors, including legacy Layout. */
export function updateView(spec, viewId, mutate) {
  return withView(spec, viewId, mutate);
}
/** Patch authored node settings without losing geometry or unrelated optional fields. */
export function setViewSettings(spec, viewId, fields) {
  return withView(spec, viewId, (view) => {
    const next = { ...view };
    for (const [key, value] of Object.entries(fields || {})) {
      if (value === undefined) delete next[key]; else next[key] = value;
    }
    return next;
  });
}

/** The label pair is ONE fact (normLabel): `labelAuto` true stores an empty label, false
 *  stores a typed one. A caller that sets only the label gets the pair the grammar implies —
 *  typing a name turns auto off, clearing it turns auto back on. */
function labelPair(o, cur) {
  const base = isObj(cur) ? cur : { label: '', labelAuto: true };
  if (!isObj(o) || !hasOwn(o, 'label')) {
    return { label: pick(o, 'label', base.label), labelAuto: pick(o, 'labelAuto', base.labelAuto) };
  }
  const label = o.label;
  return { label, labelAuto: hasOwn(o, 'labelAuto') ? o.labelAuto : label === '' };
}

/** A FRESH style per series (`emptyReport`'s own rule): a shared literal would let an edit
 *  to one series' stroke move every other series that was minted with the default. */
const defaultStyle = () => ({ type: 'line', width: 'normal', curve: 'smooth', points: false });

/** A default value for a new element: «Impressions», minted by the catalog so a CM360 widget
 *  gets the name the join feeds it (`impressions`) rather than the engine's `im`. */
const defaultValue = (spec) => mintValue(DEFAULT_METRIC, { source: 'bq', datasetType: datasetTypeOf(spec) });

/** Table E's key order, per kind. `guide` is optional and last. The KIND is stored from the
 *  input and only the key set is chosen from it, so a kind the grammar does not have is
 *  refused by name instead of being quietly assembled as a value series. */
function assembleSeries(s, cur) {
  const kind = pick(s, 'kind', pick(cur, 'kind', 'value'));
  const isCalc = kind === 'calc';
  const lab = labelPair(s, cur);
  const out = { id: pick(s, 'id', pick(cur, 'id', undefined)), kind };
  if (isCalc) {
    out.calc = pick(s, 'calc', pick(cur, 'calc', 'planPerDay'));
    out.basis = pick(s, 'basis', pick(cur, 'basis', 'im'));
    if (out.calc === 'projection') {
      out.output = pick(s, 'output', pick(cur, 'output', 'cumulative'));
      const modeControlId = pick(s, 'modeControlId', pick(cur, 'modeControlId', null));
      if (modeControlId != null) out.modeControlId = modeControlId;
    }
  }
  out.label = lab.label;
  out.labelAuto = lab.labelAuto;
  if (!isCalc) out.value = pick(s, 'value', pick(cur, 'value', null));
  out.style = pick(s, 'style', pick(cur, 'style', defaultStyle()));
  out.axis = pick(s, 'axis', pick(cur, 'axis', 'auto'));
  out.color = pick(s, 'color', pick(cur, 'color', 'auto'));
  const fill = pick(s, 'fill', pick(cur, 'fill', null));
  if (fill != null) out.fill = fill;
  const border = pick(s, 'border', pick(cur, 'border', null));
  if (border != null) out.border = border;
  out.dashed = pick(s, 'dashed', pick(cur, 'dashed', false));
  const opacity = pick(s, 'opacity', pick(cur, 'opacity', null));
  if (opacity != null) out.opacity = opacity;
  out.valuesOnChart = pick(s, 'valuesOnChart', pick(cur, 'valuesOnChart', false));
  if (!isCalc) out.accumulate = pick(s, 'accumulate', pick(cur, 'accumulate', 'daily'));
  out.hidden = pick(s, 'hidden', pick(cur, 'hidden', false));
  if (!isCalc) {
    const guide = pick(s, 'guide', pick(cur, 'guide', null));
    if (guide != null) out.guide = guide;
  }
  const highlights = pick(s, 'highlights', pick(cur, 'highlights', undefined));
  if (highlights !== undefined) out.highlights = highlights;
  return out;
}

/** Table G's key order — both column kinds carry the same one. */
function assembleColumn(c, cur) {
  const lab = labelPair(c, cur);
  const out = {
    id: pick(c, 'id', pick(cur, 'id', undefined)),
    kind: pick(c, 'kind', pick(cur, 'kind', 'value')),
    label: lab.label,
    labelAuto: lab.labelAuto,
    value: pick(c, 'value', pick(cur, 'value', null)),
    format: pick(c, 'format', pick(cur, 'format', 'auto')),
  };
  // The OPTIONAL keys (§5.2, section-widget parity 2026-09-04; `buyUnit` since the sections
  // cutover 2026-09-07; `totalAs` since formula chips P1), carried forward and appended where
  // the normalizer puts them. This
  // assembles a column from a LITERAL rather than a spread, so a key nobody listed here is
  // dropped by an edit that never mentioned it: changing a Daily Performance column's format
  // would otherwise take its plan, its hide-when-empty rule and its blanked zero away with
  // it. A further key must be listed too.
  for (const k of ['target', 'hideWhenEmpty', 'zeroAs', 'highlightExtremes', 'highlightDirection', 'buyUnit', 'totalAs', 'highlights']) {
    const v = pick(c, k, pick(cur, k, undefined));
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * newNodeId(spec, prefix) → an id no element in this spec carries, and never a legal widget
 * id: `layout.tiles` and `widgetRanges` would accept `w_abc123` as a tile, `enabled{}` would
 * drop it and groups would reject it — three answers to one id (§9's containment rule).
 *
 * One namespace for every element, because that rule is about the SPEC, not about the slot: a
 * view, a series, a column, a control, a switch option and an interaction all count here.
 *
 * A prefix that cannot mint a node id at all — too long, or one whose every candidate IS a
 * widget id (`w_abcd1`…) — falls back to `n1`, `n2`… rather than looping forever.
 */
export function newNodeId(spec, prefix) {
  const used = usedIds(spec);
  const base = typeof prefix === 'string' && /^[a-z][a-z0-9_]*$/.test(prefix) && prefix.length <= 12
    ? prefix : 'n';
  for (let n = 1; n <= used.size + 2; n++) {
    const id = base + n;
    if (isNodeId(id) && !used.has(id)) return id;
  }
  for (let n = 1; ; n++) {
    const id = `n${n}`;
    if (!used.has(id)) return id;
  }
}

function usedIds(spec) {
  const used = new Set();
  const add = (v) => { if (typeof v === 'string') used.add(v); };
  for (const v of flattenViews(views(spec))) {
    if (!isObj(v)) continue;
    add(v.id);
    for (const s of arr(v.series)) if (isObj(s)) add(s.id);
    for (const c of arr(v.columns)) if (isObj(c)) add(c.id);
  }
  for (const c of controls(spec)) {
    if (!isObj(c)) continue;
    add(c.id);
    for (const o of arr(c.options)) if (isObj(o)) add(o.id);
  }
  for (const it of arr(spec && spec.interactions)) if (isObj(it)) add(it.id);
  return used;
}

/**
 * chartAnswersFocus(view, datasetType) — does this chart hold a series the comparison's
 * focus would actually narrow? The renderer's own rule decides (`cmFeedOf`: a cm-source
 * value, or the dual-source bq twin on a deliveryCm360 dataset), plus `bound` — which on a
 * draft a compare view accepts resolves through the metric switch, whose every option
 * `normCompareView` requires to be dual-source. A calc series draws no comparison data and
 * a hidden series draws nothing at all, so neither answers. A `tupleFocus` wire to a chart
 * with no answering series is a promise the tile cannot keep: the chip says «Focus a row →
 * Chart», the row is focused, the chart does not move.
 */
export function chartAnswersFocus(view, datasetType) {
  if (!isObj(view) || view.kind !== 'chart') return false;
  return arr(view.series).some((s) => {
    if (!isObj(s) || s.kind === 'calc' || s.hidden) return false;
    const v = s.value;
    if (!isObj(v)) return false;
    if (v.kind === 'bound') return true;
    return !!cmFeedOf(v, datasetType);
  });
}

/**
 * addView(spec, kind, opts) — a new view card, valid from birth, appended in render order.
 *
 * It THROWS on a fact only the caller has: a pie's `sliceByKey`. Guessing it would cut the
 * pie by rows that are not there, and the catalog throws on the same rule (`mintValue` with
 * no datasetType). The cap is NOT applied here — §1.1.3 puts it on the affordance, with its
 * reason, and the validator refuses the seventh view by name; clamping would be the silent
 * decision §9 forbids.
 *
 * A COMPARE view is the one kind that brings other things with it (P3 decision 9), because
 * it is the one kind that stores no value of its own: it NAMES a metric switch and a
 * breakdown control, and neither of them is a fact a caller can supply that the draft does
 * not already contain. So it makes what is missing and names what is there —
 *
 *   · no metric switch → one is minted over the three fields both sources carry, which is
 *     the only shape §5.5 accepts, starting on impressions;
 *   · a metric switch that EXISTS is named as it stands, whatever its options are. §1.1.4
 *     fills an empty default and never replaces one the author chose, so a switch the
 *     comparison cannot use is refused by the grammar (and by the map that offers the pick)
 *     rather than rewritten under them;
 *   · no breakdown control → one is minted at `COMPARE_BREAKDOWN_MAX`;
 *   · exactly ONE chart that can ANSWER the focus → the `tupleFocus` §5.6 declares is
 *     declared here. A chart answers only through a series the comparison narrows
 *     (`chartAnswersFocus` below); wiring one that cannot is a promise the tile never
 *     keeps — the newborn's engine-fed series ignores the focus entirely (the
 *     sections-to-widgets audit's case J, owner 2026-08-24). None with zero answering
 *     charts, and none with two or more, where picking one would be a silent decision
 *     about the author's report.
 *
 * `opts.metricControlId` / `opts.breakdownControlId` override both lookups: a caller that
 * names a control gets exactly that one, and nothing is minted.
 */
export function addView(spec, kind, opts) {
  const o = isObj(opts) ? opts : {};
  const id = newNodeId(spec, kind);
  // Every child id is minted against a spec that already holds the new view's OWN id and
  // whichever of its children were minted before it — one namespace, and no name is free
  // twice. A compare view takes five of these; the other kinds take one or none.
  let scratch = reserved(spec, id);
  const mint = (prefix) => { const n = newNodeId(scratch, prefix); scratch = reserved(scratch, n); return n; };
  // The spec the view is appended to. Only a compare view changes it before that — it is
  // the one kind that may bring a control with it.
  let base = spec;
  let wire = null;
  let view;
  if (kind === 'chart') {
    view = {
      id, kind: 'chart', title: '', x: { type: 'date' }, orientation: 'vertical',
      series: [assembleSeries({ id: mint('s'), value: defaultValue(spec) })],
      formats: { left: 'kilo', right: 'number' },
    };
  } else if (kind === 'table') {
    view = {
      id, kind: 'table', title: '', rows: { type: 'date' },
      // The METRIC's own format, not `auto` — the same rule every column added later takes
      // (T7): the renderer's `auto` prints money and ratio totals in the wrong shape, and a
      // newborn that had to be corrected by hand is a default that decided wrongly.
      columns: [assembleColumn({
        id: mint('col'), value: defaultValue(spec), format: DEFAULT_METRIC.defaultFormat,
      })],
      totals: false,
    };
  } else if (kind === 'kpi') {
    view = {
      id, kind: 'kpi', title: '', value: defaultValue(spec),
      format: DEFAULT_METRIC.defaultFormat, deltaVsOtherSource: false,
    };
  } else if (kind === 'pie') {
    if (typeof o.sliceByKey !== 'string' || !o.sliceByKey) {
      throw new TypeError('addView: a pie is cut by a dimension; pass {sliceByKey}');
    }
    view = {
      id, kind: 'pie', title: '', value: defaultValue(spec), sliceBy: { key: o.sliceByKey },
      topN: DEFAULT_PIE_TOP_N, format: DEFAULT_METRIC.defaultFormat,
    };
  } else if (kind === 'compare') {
    let metricControlId = isNodeId(o.metricControlId) ? o.metricControlId : controlId(base, 'metric');
    if (!metricControlId) {
      const ctlId = mint('ctl');
      const datasetType = datasetTypeOf(base);
      const options = DUAL_SOURCE_ENTRIES.map((entry) => ({
        // An AUTO label, like every other minted element: §2 derives the option's caption
        // from its value, and typing one for the author is naming their switch for them.
        id: mint('o'), label: '', labelAuto: true, value: mintValue(entry, { source: 'bq', datasetType }),
      }));
      base = setControl(base, {
        type: 'metric', id: ctlId, label: CONTROL_LABEL.metric, options,
        // The switch starts on the FIRST of them — impressions, the field every pacing and
        // every CM360 export carries.
        defaultOptionId: options[0] && options[0].id,
      });
      metricControlId = ctlId;
    }
    let breakdownControlId = isNodeId(o.breakdownControlId) ? o.breakdownControlId : controlId(base, 'breakdown');
    if (!breakdownControlId) {
      const ctlId = mint('ctl');
      base = setControl(base, {
        type: 'breakdown', id: ctlId, label: CONTROL_LABEL.breakdown, maxSelected: COMPARE_BREAKDOWN_MAX,
      });
      breakdownControlId = ctlId;
    }
    view = { id, kind: 'compare', title: '', metricControlId, breakdownControlId };
    const charts = flattenViews(views(base)).filter((v) => isObj(v) && v.kind === 'chart'
      && chartAnswersFocus(v, datasetTypeOf(base)));
    if (charts.length === 1) {
      wire = { id: mint('ix'), type: 'tupleFocus', sourceViewId: id, targetViewId: charts[0].id };
    }
  } else if (kind === 'layout') {
    // Zero rows is the intentional editor-local starting state. The strict saved grammar
    // refuses it until the author adds a block, while Preview renders exactly the empty
    // draft instead of resurrecting a template or a last-valid Layout.
    view = { id, kind: 'layout', title: '', rows: [] };
  } else {
    throw new TypeError(`addView: unknown view kind "${cut(kind)}"`);
  }
  const out = { ...base, views: [...views(base), view] };
  return wire ? addInteraction(out, wire) : out;
}

/** The id of this draft's control of one type, or null — the lookup `setControl`'s upsert
 *  rule implies (Table C: at most one of each), for the two references a compare view makes. */
function controlId(spec, type) {
  const hit = controls(spec).find((c) => isObj(c) && c.type === type);
  return hit && isNodeId(hit.id) ? hit.id : null;
}

/** A scratch spec carrying one more taken id, so the next `newNodeId` cannot mint it again.
 *  A view entry holding nothing but an id is what `usedIds` reads, and one namespace covers
 *  every element (§9's containment rule) — so this reserves a control id as surely as a
 *  view's. It is never returned: only `newNodeId` ever looks at it. */
function reserved(spec, id) {
  return { ...spec, views: [...views(spec), { id }] };
}

/**
 * THE besideNext SANITY RULE (section view rows, spec 2026-08-27 §3), applied by every
 * mutator that can change WHICH view is last.
 *
 * `besideNext` says «this view and the next one share a row», so the last view is the one
 * place the mark can name nothing, and `normReport` refuses it there. The spec's own words:
 * «a mark whose next disappears is dropped by the same mutator, never left dangling for the
 * validator to refuse.» So the mutator owns the invariant and the grammar's refusal exists
 * for hand-made JSON — an author dragging cards can never reach it.
 *
 * ONE read, not a sweep: every marked view other than the last has a next by construction,
 * so the last is the only one to check. Identity is preserved when there is nothing to do —
 * the same spec object comes back — because the builder's dirty check compares by value and
 * a fresh tree per keystroke is a re-render for nothing.
 */
function noStrandedBeside(spec) {
  const list = views(spec);
  const last = list[list.length - 1];
  if (!isObj(last) || last.besideNext !== true) return spec;
  const next = list.slice();
  next[next.length - 1] = withoutBeside(last);
  return { ...spec, views: next };
}

/** A view minus its row mark. Object rest keeps the order of what remains, and the key was
 *  appended last anyway — so a view that never carried one is untouched to the byte. */
function withoutBeside(view) {
  const { besideNext, ...rest } = view;   // eslint-disable-line no-unused-vars
  return rest;
}

/** Remove a view, and with it every wire that named it — an interaction pointing at a view
 *  that is gone is a dangling reference the grammar refuses, and the author never declared it
 *  as a separate thing to delete. Removing the last view can strand the mark on the one
 *  before it, which `noStrandedBeside` drops in the same edit. */
export function removeView(spec, viewId) {
  const list = views(spec);
  const target = flattenViews(list).find((v) => isObj(v) && v.id === viewId);
  if (!target) return spec;
  const removedIds = new Set(flattenViews([target]).map((v) => v?.id));
  const wires = arr(spec.interactions);
  const keep = wires.filter((it) => isObj(it) && !removedIds.has(it.sourceViewId) && !removedIds.has(it.targetViewId));
  const out = { ...spec, views: mapViewTree(list, (v) => isObj(v) && v.id === viewId ? null : v) };
  if (keep.length !== wires.length) out.interactions = keep;
  return noStrandedBeside(out);
}

/** Move a view one place up or down. Views render top to bottom in this array's order, so
 *  this IS the reordering (§5.0's dropped `layout` constant).
 *
 *  The mark travels WITH the view, because it is the view's own key — which is what makes
 *  the pairs positional: moving a card re-pairs the row, and the live Preview is where the
 *  author reads that. The one thing that is not left to position is the strand. */
export function moveView(spec, viewId, dir) {
  let parentId = null;
  walkViewNodes(views(spec), (node, info) => { if (node?.id === viewId) parentId = info.parent?.id || null; });
  if (parentId) return withView(spec, parentId, (parent) => {
    const out = moved(arr(parent.children), viewId, dir, (children) => ({ ...parent, children }));
    return out || parent;
  });
  const list = views(spec);
  const out = moved(list, viewId, dir, (next) => ({ ...spec, views: next }));
  return out ? noStrandedBeside(out) : spec;
}

/** Move a view to an INDEX — what a drop means, where `moveView` is what a ▲▼ press means
 *  (T17). The pair is deliberate: a step and a landing are two different edits, and the
 *  keyboard path keeps the one it has. */
export function moveViewTo(spec, viewId, index) {
  let parentId = null;
  walkViewNodes(views(spec), (node, info) => { if (node?.id === viewId) parentId = info.parent?.id || null; });
  if (parentId) return withView(spec, parentId, (parent) => {
    const out = movedTo(arr(parent.children), viewId, index, (children) => ({ ...parent, children }));
    return out || parent;
  });
  const list = views(spec);
  const out = movedTo(list, viewId, index, (next) => ({ ...spec, views: next }));
  return out ? noStrandedBeside(out) : spec;
}

/**
 * setBesideNext(spec, viewId, on) — «this view shares its row with the next one» (§3).
 *
 * The ONE authored composition fact in the grammar, written the way the grammar stores it:
 * `true` or nothing at all. `false` is not a third state — §9 has one spelling per fact, and
 * an author who turns the toggle off is saying the key is absent.
 *
 * On the LAST view `on: true` writes NOTHING and hands the spec straight back: the mark
 * would name a view that is not there, and this module never mints a draft the server
 * refuses. The toggle on that card is refused in the builder with `BESIDE_NO_NEXT` printed
 * beside it, so nobody meets this guard by clicking — it is the belt under that brace.
 */
export function setBesideNext(spec, viewId, on) {
  const list = views(spec);
  const i = list.findIndex((v) => isObj(v) && v.id === viewId);
  if (i === -1) return spec;
  const want = on === true && i < list.length - 1;
  if (want === (list[i].besideNext === true)) return spec;
  const next = list.slice();
  // APPENDED, so a view that gains a mark keeps the key order the normalizer stores.
  next[i] = want ? { ...list[i], besideNext: true } : withoutBeside(list[i]);
  return { ...spec, views: next };
}

function moved(list, id, dir, make) {
  const i = list.findIndex((x) => isObj(x) && x.id === id);
  if (i === -1) return null;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return null;
  const next = list.slice();
  next[i] = list[j];
  next[j] = list[i];
  return make(next);
}

/**
 * The landing half of `moved`. `index` is counted in the list the element ENDS UP in — the
 * list minus the element being moved — so the last place is always `length - 1`, whichever
 * direction it travelled from.
 *
 * Three ways to write nothing, and each returns `null` so the caller hands back the spec it
 * was given, unchanged and IDENTICAL: an id this list does not carry, an index that is not
 * a whole number (which is what `dropIndex` answers for a drop the list should refuse — a
 * bare `Number()` would have read `null` as 0 and moved the element to the front), and an
 * index the element already holds. An index outside the list is not one of the three: a
 * drop past the last row is a drop at the end, so it clamps.
 */
function movedTo(list, id, index, make) {
  const i = list.findIndex((x) => isObj(x) && x.id === id);
  if (i === -1 || !Number.isInteger(index)) return null;
  const at = Math.max(0, Math.min(index, list.length - 1));
  if (at === i) return null;
  const next = list.slice();
  next.splice(i, 1);
  next.splice(at, 0, list[i]);
  return make(next);
}

/** Add a series to a chart. `seriesOrCalc` is a value series (`{value, …}`) or a calculation
 *  (`{kind:'calc', calc}`); anything it does not say takes the grammar's default. */
export function addSeries(spec, viewId, seriesOrCalc) {
  const s = isObj(seriesOrCalc) ? seriesOrCalc : {};
  const id = isNodeId(s.id) ? s.id : newNodeId(spec, 's');
  const body = assembleSeries({ ...s, id, value: pick(s, 'value', defaultValue(spec)) }, null);
  return withView(spec, viewId, (v) => ({ ...v, series: [...arr(v.series), body] }), 'chart');
}

export function patchSeries(spec, viewId, seriesId, patch) {
  return withView(spec, viewId, (v) => {
    const list = arr(v.series);
    const i = list.findIndex((s) => isObj(s) && s.id === seriesId);
    if (i === -1) return v;
    const p = isObj(patch) ? patch : {};
    // A guide is cleared by patching it to null — `× clears` in the series popover.
    const cur = hasOwn(p, 'guide') && p.guide == null ? { ...list[i], guide: null } : list[i];
    const next = list.slice();
    next[i] = assembleSeries({ ...p, id: list[i].id }, cur);
    return { ...v, series: next };
  });
}

export function removeSeries(spec, viewId, seriesId) {
  return withView(spec, viewId, (v) => {
    const list = arr(v.series);
    if (!list.some((s) => isObj(s) && s.id === seriesId)) return v;
    return { ...v, series: list.filter((s) => !(isObj(s) && s.id === seriesId)) };
  });
}

/** The defaults of a new calculated Guide (spec 2026-09-10 «The child»): no basis, no output
 *  and no label — the parent's metric and accumulate decide the first two at render time and
 *  the name derives from them. It follows the widget's Projection switch when one exists. */
export function calculatedGuideDefaults(series, spec) {
  const control = arr(spec && spec.controls).find((c) => isObj(c) && c.type === 'projection');
  return { calc: 'projection', ...(control ? { modeControlId: control.id } : {}), invert: false,
    style: { type: 'line', width: 1.5, curve: 'smooth', points: false }, color: 'expected',
    dashed: series && series.accumulate === 'cumulative' ? 'medium' : 'short', opacity: 1, valuesOnChart: false };
}

/** Every metric the pacing engine plans that this series can show: its own, or each option of
 *  the metric switch it follows. Empty when the series has no plan at all. */
function plannedBases(series, spec) {
  const value = isObj(series) ? series.value : null;
  if (!isObj(value)) return [];
  if (value.kind !== 'bound') { const basis = guideBasisOf(value); return basis ? [basis] : []; }
  const ctl = arr(spec && spec.controls).find((c) => isObj(c) && c.type === 'metric');
  return arr(ctl && ctl.options).map((o) => guideBasisOf(isObj(o) ? o.value : null)).filter(Boolean);
}

/**
 * Adding Expected to a value series, as ONE patch — one Apply, one Undo (spec 2026-09-10
 * «The child»). The Guide joins the series: a calculated one already there keeps its mode, a
 * fixed one gives way but keeps its appearance and drops its «lower is better» reading. And the
 * standalone projection series the Guide replaces leaves the chart: same basis as the parent's
 * metric (any switch option), same daily/cumulative kind, not hidden. Nothing else moves.
 */
export function addCalculatedGuide(spec, viewId, seriesId) {
  return withView(spec, viewId, (v) => {
    const list = arr(v.series);
    const i = list.findIndex((s) => isObj(s) && s.id === seriesId);
    if (i === -1 || list[i].kind === 'calc') return v;
    const parent = list[i];
    const current = isObj(parent.guide) ? parent.guide : null;
    const calculated = !!current && current.calc === 'projection';
    const defaults = calculatedGuideDefaults(parent, spec);
    const guide = { ...defaults, ...(current || {}) };
    delete guide.value; delete guide.mode; delete guide.modeControlId;
    guide.calc = 'projection';
    guide.invert = false;
    if (calculated && current.mode) guide.mode = current.mode;
    else if (calculated && current.modeControlId) guide.modeControlId = current.modeControlId;
    else if (defaults.modeControlId) guide.modeControlId = defaults.modeControlId;
    const bases = new Set(plannedBases(parent, spec));
    const cumulative = parent.accumulate === 'cumulative';
    const retired = (s) => isObj(s) && s.kind === 'calc' && s.calc === 'projection' && !s.hidden
      && bases.has(s.basis) && (s.output === 'cumulative') === cumulative;
    const next = list.filter((s) => !retired(s));
    const j = next.indexOf(parent);
    next[j] = assembleSeries({ guide, id: parent.id }, parent);
    return { ...v, series: next };
  }, 'chart');
}

/** Does anything in the spec still follow the Projection switch `controlId`? A standalone
 *  projection series or a calculated Guide naming it. */
function projectionSwitchFollowed(spec, controlId) {
  return flattenViews(views(spec)).some((v) => isObj(v) && v.kind === 'chart' && arr(v.series).some((s) => isObj(s)
    && ((s.kind === 'calc' && s.calc === 'projection' && s.modeControlId === controlId)
      || (isObj(s.guide) && s.guide.calc === 'projection' && s.guide.modeControlId === controlId))));
}

/**
 * The Mode row of a calculated Guide, as ONE patch (owner ruling 2026-09-10). `pick` is
 * 'plan', 'reforecast' or the id of the widget's Projection switch. Fixing the mode retires
 * that switch when nothing else follows it: the chip exists only for the Expected line, a
 * chip nobody reads is not a state a viewer should see, and the grammar refuses to store it
 * anyway. One Undo brings back both the mode and the chip. Choosing the switch is the plain
 * guide patch; on a widget without one the popover's own «add switch» button mints it first.
 */
export function setCalculatedGuideMode(spec, viewId, seriesId, pick) {
  const control = controls(spec).find((c) => isObj(c) && c.type === 'projection') || null;
  const follow = !!control && pick === control.id;
  const fields = follow ? { modeControlId: control.id, mode: null }
    : { modeControlId: null, mode: pick === 'reforecast' ? 'reforecast' : null };
  let current = null;
  for (const v of flattenViews(views(spec))) {
    if (isObj(v) && v.kind === 'chart' && v.id === viewId) current = arr(v.series).find((s) => isObj(s) && s.id === seriesId) || null;
  }
  if (!current || !isObj(current.guide) || current.guide.calc !== 'projection') return spec;
  const guide = { ...current.guide, ...fields };
  for (const key of Object.keys(guide)) if (guide[key] == null) delete guide[key];
  const next = patchSeries(spec, viewId, seriesId, { guide });
  if (follow || !control || projectionSwitchFollowed(next, control.id)) return next;
  return removeControl(next, 'projection');
}

export function moveSeries(spec, viewId, seriesId, dir) {
  return withView(spec, viewId, (v) => moved(arr(v.series), seriesId, dir, (next) => ({ ...v, series: next })) || v);
}

/** The drop half (T17). Gated on `chart` the way `addSeries` is: a series list belongs to a
 *  chart, and a drop naming any other view writes nothing. */
export function moveSeriesTo(spec, viewId, seriesId, index) {
  return withView(spec, viewId,
    (v) => movedTo(arr(v.series), seriesId, index, (next) => ({ ...v, series: next })) || v, 'chart');
}

/** Add a column to a table. `column` is `{value, format}` for a value column or
 *  `{kind:'delta', value, format}` for a Δ%. */
export function addColumn(spec, viewId, column) {
  const c = isObj(column) ? column : {};
  const id = isNodeId(c.id) ? c.id : newNodeId(spec, 'col');
  const body = assembleColumn({ ...c, id, value: pick(c, 'value', defaultValue(spec)) }, null);
  return withView(spec, viewId, (v) => ({ ...v, columns: [...arr(v.columns), body] }), 'table');
}

export function patchColumn(spec, viewId, columnId, patch) {
  return withView(spec, viewId, (v) => {
    const list = arr(v.columns);
    const i = list.findIndex((c) => isObj(c) && c.id === columnId);
    if (i === -1) return v;
    const next = list.slice();
    next[i] = assembleColumn({ ...(isObj(patch) ? patch : {}), id: list[i].id }, list[i]);
    return { ...v, columns: next };
  });
}

/** Remove a column, and the two view keys that NAME a column with it — the authored sort and
 *  the per-row share. Both are refused by the grammar once the column is gone, and neither is
 *  something the reader chose as a separate thing to delete: there is no share control in the
 *  builder at all, so a draft left holding one could only be recovered by discarding it. */
export function removeColumn(spec, viewId, columnId) {
  return withView(spec, viewId, (v) => {
    const list = arr(v.columns);
    if (!list.some((c) => isObj(c) && c.id === columnId)) return v;
    const next = { ...v, columns: list.filter((c) => !(isObj(c) && c.id === columnId)) };
    if (isObj(v.sort) && v.sort.columnId === columnId) delete next.sort;
    if (isObj(v.share) && v.share.columnId === columnId) delete next.share;
    if (!next.share && next.sort?.columnId === '__share__') delete next.sort;
    return next;
  });
}

export function moveColumn(spec, viewId, columnId, dir) {
  return withView(spec, viewId, (v) => moved(arr(v.columns), columnId, dir, (next) => ({ ...v, columns: next })) || v);
}

/** The drop half (T17). Gated on `table`, the way `addColumn` is. The authored sort names a
 *  column by ID and so survives every reorder untouched — `removeColumn` is the one mutator
 *  a sort has to hear about. */
export function moveColumnTo(spec, viewId, columnId, index) {
  return withView(spec, viewId,
    (v) => movedTo(arr(v.columns), columnId, index, (next) => ({ ...v, columns: next })) || v, 'table');
}

/** The chart's X axis (§5.1) — `{type:'date'|'li'}` or `{type:'dim', key}`. Nothing else on
 *  the view moves with it: a stored `topN` or a horizontal orientation that the new grain
 *  refuses is named by the validator as a context conflict, with Fix or Undo, rather than
 *  being deleted under the author (§9). */
export function setX(spec, viewId, x) {
  const next = grain(x, 'date');
  return withView(spec, viewId, (v) => ({ ...v, x: next }), 'chart');
}

/**
 * The chart's orientation (§5.1) — the toggle the card shows off the date axis. It writes
 * the one key: a horizontal DATE chart is refused by the grammar, and the refusal is what
 * names it rather than this quietly switching the axis back.
 */
export function setOrientation(spec, viewId, orientation) {
  return withView(spec, viewId, (v) => ({ ...v, orientation }), 'chart');
}

/**
 * The chart's Top N (§7.3), or `null` for «draw them all». The KEY goes with the null,
 * because `topN` is optional in Table D and an absent key is the only way to say «no fold»
 * — a stored `topN` nobody applies is a setting that lies, which is why the grammar refuses
 * one on a date axis instead of ignoring it.
 *
 * Nothing is clamped (§9): a number outside 1..LIMITS.chartTopN is stored and the validator
 * names it. Written LAST, which is where Table D's key order puts it.
 */
export function setTopN(spec, viewId, n) {
  return withView(spec, viewId, (v) => {
    if (n == null) {
      if (!hasOwn(v, 'topN')) return v;
      const { topN, ...rest } = v;   // eslint-disable-line no-unused-vars
      return rest;
    }
    return { ...v, topN: n };
  }, 'chart');
}

/** Rebuild a Chart in the wire grammar's key order after adding/removing one of its optional
 * presentation fields. Most chart edits replace an existing key and therefore preserve the
 * order automatically; these four settings can create a key that was absent in a migrated
 * custom Widget, so a spread would append it after `topN` and make a just-saved draft look
 * dirty when the server returned the normalized order. */
function chartOrder(v) {
  const out = { id: v.id, kind: v.kind, title: v.title };
  if (hasOwn(v, 'titleAuto')) out.titleAuto = v.titleAuto;
  out.x = v.x;
  out.orientation = v.orientation;
  out.series = v.series;
  out.formats = v.formats;
  if (hasOwn(v, 'emptyBehavior')) out.emptyBehavior = v.emptyBehavior;
  if (hasOwn(v, 'journal')) out.journal = v.journal;
  if (hasOwn(v, 'topN')) out.topN = v.topN;
  return keepRest(out, v);
}

/** Automatic Chart title is explicit authored data. Enabling it clears the authored title,
 * as required by the grammar; disabling it leaves an empty editable title rather than
 * guessing words for the author. */
export function setChartTitleAuto(spec, viewId, enabled) {
  return withView(spec, viewId, (v) => chartOrder({
    ...v,
    title: enabled ? '' : v.title,
    titleAuto: !!enabled,
  }), 'chart');
}

/** Calendar includes every day in the selected window; factDates draws only dates carrying
 * facts. The discriminator remains inside the Date axis and is removed for the historical
 * omission/default form only when `domain` is null. */
export function setChartDateDomain(spec, viewId, domain) {
  return withView(spec, viewId, (v) => {
    if (!isObj(v.x) || v.x.type !== 'date') return v;
    const x = domain == null ? { type: 'date' } : { type: 'date', domain };
    return { ...v, x };
  }, 'chart');
}

export function setChartEmptyBehavior(spec, viewId, behavior) {
  return withView(spec, viewId, (v) => chartOrder({ ...v, emptyBehavior: behavior }), 'chart');
}

export function setChartJournal(spec, viewId, enabled) {
  return withView(spec, viewId, (v) => chartOrder({ ...v, journal: !!enabled }), 'chart');
}

/** One side of the chart's axis-scale pair (§5.1, Table D). The pair is always fully
 *  materialized — `{left, right}`, in that order — so this replaces one member of it. */
export function setAxisFormat(spec, viewId, side, format) {
  const key = side === 'right' ? 'right' : 'left';
  return withView(spec, viewId, (v) => {
    const cur = isObj(v.formats) ? v.formats : {};
    return { ...v, formats: { left: key === 'left' ? format : cur.left, right: key === 'right' ? format : cur.right } };
  }, 'chart');
}

/**
 * One series' STYLE (Table F). The type decides the key set and every sub-key is required,
 * so a partial patch is MORPHED rather than merged: switching a line to a bar drops the
 * stroke keys the bar has no room for, and switching back fills the defaults a new series is
 * born with. A popover that spread `{type:'bar'}` over a line style would fail the whole
 * draft with «unknown key "width"».
 *
 * What survives a morph is what the new type also has: every style keeps stroke width,
 * line ⇄ area also keep curve/points, and area fill / bar layout remain type-specific.
 */
export function setSeriesStyle(spec, viewId, seriesId, style) {
  return withView(spec, viewId, (v) => {
    const list = arr(v.series);
    const i = list.findIndex((s) => isObj(s) && s.id === seriesId);
    if (i === -1) return v;
    const next = list.slice();
    next[i] = assembleSeries({ style: styleFor(list[i].style, style) }, list[i]);
    return { ...v, series: next };
  }, 'chart');
}

/** Table F's key order, per type, over the merge of what is there and what was asked for. */
function styleFor(cur, patch) {
  const c = isObj(cur) ? cur : {};
  const p = isObj(patch) ? patch : {};
  const type = pick(p, 'type', pick(c, 'type', 'line'));
  const base = defaultStyle();
  if (type === 'bar') {
    return {
      type: 'bar',
      bars: pick(p, 'bars', pick(c, 'bars', 'grouped')),
      width: pick(p, 'width', pick(c, 'width', base.width)),
    };
  }
  const out = {
    type,
    width: pick(p, 'width', pick(c, 'width', base.width)),
    curve: pick(p, 'curve', pick(c, 'curve', base.curve)),
    points: pick(p, 'points', pick(c, 'points', base.points)),
  };
  if (type === 'area') out.fill = pick(p, 'fill', pick(c, 'fill', 'light'));
  return out;
}

/** The table's row grain (§5.2) — one more type than a chart's X: `dateLi`. */
export function setRows(spec, viewId, rows) {
  const next = grain(rows, 'date');
  return withView(spec, viewId, (v) => ({ ...v, rows: next }), 'table');
}

/** An independent value or an existing column, kept exactly as the author chose. */
export function setShare(spec, viewId, share) {
  return withView(spec, viewId, (v) => {
    const next = { ...v };
    if (share == null) delete next.share;
    else next.share = structuredClone(share);
    if (!next.share && next.sort?.columnId === '__share__') delete next.sort;
    return next;
  }, 'table');
}

/**
 * Table D's key order for a TABLE view. `sort` is optional and sits BETWEEN `columns` and
 * `totals`, and `limit` is optional and last — so a mutator that spread a new `sort` onto
 * the view would store it after `totals`, and the drawer's dirty check byte-compares the
 * draft against what came back from PG in the grammar's order.
 *
 * It rebuilds from what the view HAS: an optional key that is absent stays absent, because
 * absence is what the grammar reads as «the default order» and «print every row».
 */
function tableOrder(v) {
  const out = { id: v.id, kind: v.kind, title: v.title, rows: v.rows, columns: v.columns };
  if (hasOwn(v, 'sort')) out.sort = v.sort;
  out.totals = v.totals;
  if (hasOwn(v, 'limit')) out.limit = v.limit;
  return keepRest(out, v);
}

/**
 * …and every key the view carries that Table D does NOT name, kept, last.
 *
 * A rebuild from a fixed list is a filter, and dropping a key the grammar would refuse by
 * name (`onlyKeys`: «unknown key "topN" on a table view») is the silent repair §9 forbids:
 * the widget saves, the author is never told, and whatever wrote that key is never found.
 * The refusal has to survive the next edit to the view, so the key does.
 *
 * Position does not matter: a VALID draft has no extras at all, so the byte order these two
 * functions exist to keep is untouched by this.
 */
function keepRest(out, v) {
  for (const k of Object.keys(v)) if (!hasOwn(out, k)) out[k] = v[k];
  return out;
}

/**
 * The authored sort (§5.2) — `{columnId, dir}`, or `null` for the grammar's own default
 * (the row itself, ascending). The KEY goes with the null: `sort` is optional in Table D,
 * and an absent one is the only way to say «nothing was authored here».
 *
 * `columnId` may be a column of this table or `ROW_SORT_KEY`, and neither is checked here:
 * a sort naming a column that is gone is refused BY NAME by the validator (§9), which is
 * how the author finds out rather than having the choice silently repaired.
 */
export function setSort(spec, viewId, sort) {
  return withView(spec, viewId, (v) => {
    if (sort == null) {
      if (!hasOwn(v, 'sort')) return v;
      const { sort: gone, ...rest } = v;   // eslint-disable-line no-unused-vars
      return tableOrder(rest);
    }
    // normSort's own key order, so the two objects compare byte for byte.
    return tableOrder({ ...v, sort: { columnId: sort.columnId, dir: sort.dir } });
  }, 'table');
}

/** The totals row (§5.2). `totals` is REQUIRED — a table either prints one or it does not,
 *  and there is no third answer — so this writes the boolean it is given and never a key. */
export function setTotals(spec, viewId, on) {
  return withView(spec, viewId, (v) => tableOrder({ ...v, totals: on }), 'table');
}

/**
 * How many rows the table prints (§5.2), or `null` for all of them — the table's twin of
 * the chart's Top N, with the same two rules: the KEY goes with the null (an absent `limit`
 * is the only way the grammar says «every row»), and nothing is clamped (§9) — a number
 * outside 1..LIMITS.tableLimit is stored and the validator names it.
 */
export function setLimit(spec, viewId, n) {
  return withView(spec, viewId, (v) => {
    if (n == null) {
      if (!hasOwn(v, 'limit')) return v;
      const { limit: gone, ...rest } = v;   // eslint-disable-line no-unused-vars
      return tableOrder(rest);
    }
    return tableOrder({ ...v, limit: n });
  }, 'table');
}

function grain(g, fallback) {
  const key = typeof g === 'string' ? null : (isObj(g) ? g.key : null);
  const type = typeof g === 'string' ? g : (isObj(g) && typeof g.type === 'string' ? g.type : fallback);
  // A control grain names a SWITCH instead of a key (M4) — the one grain whose dimension is
  // the viewer's answer rather than the author's.
  if (type === 'control') return { type: 'control', controlId: isObj(g) ? g.controlId : null };
  return type === 'dim' ? { type: 'dim', key } : { type };
}

/**
 * The pie's slice dimension (§5.4). Takes the key, the `{key}` object the spec stores, or —
 * since M4 — the `{controlId}` that follows the dimension switch. The pie is the one slot
 * with no `type` discriminator, so the KEY that is present is what says which shape it is.
 */
export function setSliceBy(spec, viewId, sliceBy) {
  if (isObj(sliceBy) && hasOwn(sliceBy, 'controlId')) {
    return withView(spec, viewId, (v) => ({ ...v, sliceBy: { controlId: sliceBy.controlId } }), 'pie');
  }
  const key = typeof sliceBy === 'string' ? sliceBy : (isObj(sliceBy) ? sliceBy.key : null);
  return withView(spec, viewId, (v) => ({ ...v, sliceBy: { key } }), 'pie');
}

/* ── the two views that hold ONE value (§5.3, §5.4) ─────────────────────────── */

/** The kinds whose value and format live on the VIEW. A chart holds its values in series
 *  and a table in columns, so writing `value` onto either would fail the whole draft with
 *  «unknown key» — which is why these two are gated together and not by name at each site. */
const VALUE_VIEWS = ['kpi', 'pie'];

/**
 * A view's own caption (Table D's `title`) — the KPI's and the pie's only text, and the one
 * §6 hangs the ⇄ mark on. Every view kind carries the key, so this is the one mutator here
 * with no kind gate; it is a REPLACE of an existing key, so the stored order does not move.
 */
export function setViewTitle(spec, viewId, title) {
  return withView(spec, viewId, (v) => {
    // Typing an authored Chart title is also the explicit act of leaving Auto title. Keeping
    // `titleAuto:true` beside non-empty text would create an invalid intermediate draft.
    if (v.kind === 'chart' && v.titleAuto && title !== '') {
      return chartOrder({ ...v, title, titleAuto: false });
    }
    return { ...v, title };
  });
}

/**
 * The one value a KPI or a pie draws (§5.3/§5.4). The FORMAT does not follow it here: the
 * caller re-mints that through `formatFor` (§1.1.4 — an empty default is filled, a choice
 * the new family can still print is kept), because only the caller knows which catalog
 * entry the value was minted from. A stale format of the old family is refused by name at
 * the Save gate, never repaired here (§9).
 */
export function setViewValue(spec, viewId, value) {
  return withView(spec, viewId, (v) => ({ ...v, value }), VALUE_VIEWS);
}

/** What that value PRINTS (§5.3/§5.4). `auto` is not in either vocabulary — the grammar
 *  refuses it on both kinds — and nothing here filters: a format the picker offered is what
 *  is stored, and one it could not have offered is named by the validator. */
export function setViewFormat(spec, viewId, format) {
  return withView(spec, viewId, (v) => ({ ...v, format }), VALUE_VIEWS);
}

/**
 * Table D's key order for a KPI view. `target` is optional and sits BETWEEN `format` and
 * `deltaVsOtherSource`, so a mutator that spread a new target onto the view would store it
 * last — and the drawer's dirty check byte-compares the draft against what came back from
 * PG in the grammar's order.
 */
function kpiOrder(v) {
  const out = { id: v.id, kind: v.kind, title: v.title, value: v.value, format: v.format };
  if (hasOwn(v, 'target')) out.target = v.target;
  out.deltaVsOtherSource = v.deltaVsOtherSource;
  return keepRest(out, v);
}

/**
 * The KPI's target (§5.3) — `{value, invert}`, or `null` for none. The KEY goes with the
 * null: `target` is optional in Table D, and an absent one is the only way the grammar says
 * «nothing to measure against».
 *
 * Neither half is checked here. A target is a FIXED value — `normTarget` refuses a bound one
 * — and it carries the unit family of the value it measures; both are named BY NAME by the
 * validator when they are wrong, which is how the author finds out rather than having the
 * choice silently repaired.
 */
export function setTarget(spec, viewId, target) {
  return withView(spec, viewId, (v) => {
    if (target == null) {
      if (!hasOwn(v, 'target')) return v;
      const { target: gone, ...rest } = v;   // eslint-disable-line no-unused-vars
      return kpiOrder(rest);
    }
    // normTarget's own key order, so the two objects compare byte for byte. The highlight
    // CORRIDOR (`band`, section-widget parity 2026-09-04) rides along: it names which of the
    // product's two highlights judges this cell, which is a property of the cell rather than of
    // the expression, and no panel offers it — dropping it here would take the amber off a
    // «Targets» cell the moment somebody re-picked its goal, with no way to put it back.
    const next = { value: target.value, invert: target.invert };
    const band = hasOwn(target, 'band') ? target.band : (isObj(v.target) ? v.target.band : undefined);
    if (band !== undefined) next.band = band;
    // Editing a known field must not silently erase stored fields awaiting repair.
    for (const [key, value] of Object.entries({ ...(isObj(v.target) ? v.target : {}), ...target })) {
      if (!['value', 'invert', 'band'].includes(key)) next[key] = value;
    }
    return kpiOrder({ ...v, target: next });
  }, 'kpi');
}

/** The Δ-vs-other-source support line (§5.3). It is REQUIRED — a KPI either draws one or it
 *  does not — so this writes the boolean it is given and never a key. `true` off a CM360
 *  dataset, or on a value the two sources do not share, is STORED and named by the
 *  validator: §9 forbids the silent repair, and both sentences are the grammar's. */
export function setDeltaVsOtherSource(spec, viewId, on) {
  return withView(spec, viewId, (v) => kpiOrder({ ...v, deltaVsOtherSource: on }), 'kpi');
}

/**
 * How many slices the pie draws before the tail folds into Others (§5.4). The chart's Top N
 * has a null that REMOVES the key; this one has none — a pie always folds, so `topN` is
 * required and there is no «draw them all».
 *
 * Nothing is clamped (§9), and an emptied field stores the nothing it holds rather than
 * snapping back to the number the author has just deleted: out of range, or not a number at
 * all, the validator names it.
 */
export function setPieTopN(spec, viewId, n) {
  return withView(spec, viewId, (v) => ({ ...v, topN: n }), 'pie');
}

/** Where a control sorts in the STORED order — `-1` for anything that is not one, which
 *  keeps a junk entry in the list (and first) instead of throwing on its missing `type`. */
const ctlOrder = (c) => CONTROL_TYPES.indexOf(isObj(c) ? c.type : null);

/**
 * setControl(spec, control) — UPSERT BY TYPE (Table C: at most one of each). An existing
 * control of that type keeps its id, because every bound element and every compare view
 * already names it; a new one is minted in the grammar's `CONTROL_TYPES` order.
 */
export function setControl(spec, control) {
  const c = isObj(control) ? control : {};
  const type = c.type;
  if (CONTROL_TYPES.indexOf(type) === -1) return spec;
  const list = controls(spec);
  const cur = list.find((x) => isObj(x) && x.type === type) || null;
  const id = isNodeId(c.id) ? c.id : (cur && isNodeId(cur.id) ? cur.id : newNodeId(spec, 'ctl'));
  const body = assembleControl(type, c, cur, id);
  const next = list.filter((x) => !(isObj(x) && x.type === type)).concat([body]);
  // An entry that is not a control at all is KEPT (swallowing it would hide a picker's bug
  // from the validator, which names it) — so the comparator has to survive one: `null.type`
  // would take the drawer down on a draft the validator was about to refuse by name.
  next.sort((a, b) => ctlOrder(a) - ctlOrder(b));
  return { ...spec, controls: next };
}

function assembleControl(type, c, cur, id) {
  const label = pick(c, 'label', pick(cur, 'label', ''));
  if (type === 'period') {
    // The stored order comes from PERIOD_CHOICES and not from the author (normControl's own
    // rule) — `auto` first, then the ranges — so two authors who picked the same choices
    // store the same bytes. Anything that is not a choice rides along at the end rather than
    // being dropped here: the validator names it, and a mutator that swallowed it would
    // leave the picker's bug invisible.
    const picked = arr(pick(c, 'options', pick(cur, 'options', [])));
    const known = PERIOD_CHOICES.filter((r) => picked.indexOf(r) !== -1);
    return {
      id, type: 'period', label,
      options: known.concat(picked.filter((r) => PERIOD_CHOICES.indexOf(r) === -1)),
      defaultOption: pick(c, 'defaultOption', pick(cur, 'defaultOption', undefined)),
    };
  }
  if (type === 'dimension') {
    // AUTO (sections cutover 2026-09-07): the flag alone, no list — a list beside it is the
    // shape the grammar refuses. `optionsAuto: false` in the patch is how the popover's «Pick»
    // choice asks for the stored-list shape back.
    const auto = pick(c, 'optionsAuto', pick(cur, 'optionsAuto', undefined));
    if (auto === true) return { id, type: 'dimension', label, optionsAuto: true };
    // The author's order, verbatim (normControl's own rule): a dimension list has no order
    // the grammar can see, and the stored order IS the chip order the viewer reads. What is
    // NOT here is a filter — an entry that is not a dimension rides along and the validator
    // names it, exactly as a non-range does on the period switch above.
    return {
      id, type: 'dimension', label,
      options: arr(pick(c, 'options', pick(cur, 'options', []))),
      defaultOption: pick(c, 'defaultOption', pick(cur, 'defaultOption', undefined)),
    };
  }
  if (type === 'metric') {
    const options = arr(pick(c, 'options', pick(cur, 'options', []))).map((o) => {
      const lab = labelPair(o, null);
      return { id: pick(o, 'id', undefined), label: lab.label, labelAuto: lab.labelAuto, value: pick(o, 'value', null) };
    });
    const out = {
      id, type: 'metric', label, options,
      defaultOptionId: pick(c, 'defaultOptionId', pick(cur, 'defaultOptionId', undefined)),
    };
    // `null` in the patch drops the key (the popover's unchecked box); absent keeps it.
    const defaultBy = pick(c, 'defaultBy', pick(cur, 'defaultBy', undefined));
    if (typeof defaultBy === 'string') out.defaultBy = defaultBy;
    return out;
  }
  if (type === 'projection') return { id, type: 'projection', label };
  return { id, type: 'breakdown', label, maxSelected: pick(c, 'maxSelected', pick(cur, 'maxSelected', 1)) };
}

/**
 * removeControl(spec, type, opts) — and for the metric switch, §6's own rule: «Deleting the
 * switch re-fixes bound elements to the currently selected option». The builder passes the id
 * the viewer is on (`opts.currentOptionId`); with none, the switch's own default is used.
 *
 * A switch with no option to re-fix TO leaves the bound elements alone: the validator then
 * names each of them («a bound value follows the metric switch, and this widget has no metric
 * control»), which is the honest end of an impossible state — inventing a value would be the
 * silent decision §9 forbids.
 */
export function removeControl(spec, type, opts) {
  const list = controls(spec);
  const gone = list.find((c) => isObj(c) && c.type === type);
  if (!gone) return spec;
  const next = { ...spec, controls: list.filter((c) => c !== gone) };
  if (type === 'dimension') {
    // The metric switch's rule, one slot over: the author is deleting the SWITCH, not the
    // views, so every grain that followed it is fixed to the dimension the viewer would have
    // been on (`opts.currentOption`), or to the switch's own default. A switch with nothing
    // to fix TO leaves them naming a control that is gone, and the validator says so of each
    // one — inventing a dimension would be the silent decision §9 forbids.
    // An auto switch has no stored list: the pick the viewer was on is what the builder passes
    // (it runs the same pre-step the tile does); with none, the seed's own fallback — the one
    // dimension almost every pacing carries — rather than a dangling control reference.
    const auto = gone.optionsAuto === true;
    const options = auto ? [] : arr(gone.options);
    const wanted = isObj(opts) ? opts.currentOption : null;
    const key = typeof wanted === 'string' && (auto || options.indexOf(wanted) !== -1) ? wanted
      : (auto ? 'audience'
        : (options.indexOf(gone.defaultOption) !== -1 ? gone.defaultOption : options[0]));
    if (typeof key !== 'string') return next;
    return { ...next, views: mapViewTree(views(next), (v) => refixGrain(v, gone.id, key)) };
  }
  if (type === 'projection') {
    // Removing the viewer switch fixes every named projection to Plan. In the wire grammar
    // that is represented by absence of `modeControlId`; leaving a dangling id would make
    // the whole Widget unsavable, while inventing a second mode would change its numbers.
    return { ...next, views: mapViewTree(views(next), (v) => {
      if (!isObj(v) || v.kind !== 'chart') return v;
      return { ...v, series: arr(v.series).map((s) => {
        if (!isObj(s)) return s;
        if (s.kind === 'calc' && s.calc === 'projection' && s.modeControlId === gone.id) {
          return assembleSeries({ modeControlId: null }, s);
        }
        if (s.guide?.calc === 'projection' && s.guide.modeControlId === gone.id) {
          const { modeControlId, ...guide } = s.guide;
          return { ...s, guide };
        }
        return s;
      }) };
    }) };
  }
  if (type !== 'metric') return next;
  const options = arr(gone.options);
  const wanted = isObj(opts) ? opts.currentOptionId : null;
  const opt = options.find((o) => isObj(o) && o.id === wanted)
    || options.find((o) => isObj(o) && o.id === gone.defaultOptionId)
    || options[0];
  if (!isObj(opt) || !isObj(opt.value)) return next;
  return { ...next, views: mapViewTree(views(next), (v) => refixView(v, opt.value)) };
}

/** …and the GRAIN slot of one view, with a grain that followed `controlId` replaced by the
 *  fixed dimension it was resolving to. `refixView`'s twin, and the only reason it is a
 *  second function is that a grain lives in a different slot per view kind. */
function refixGrain(v, controlId, key) {
  if (!isObj(v)) return v;
  const follows = (g) => isObj(g) && g.type === 'control' && g.controlId === controlId;
  if (v.kind === 'chart' && follows(v.x)) return { ...v, x: { type: 'dim', key } };
  if (v.kind === 'table' && follows(v.rows)) return { ...v, rows: { type: 'dim', key } };
  if (v.kind === 'pie' && isObj(v.sliceBy) && v.sliceBy.controlId === controlId) {
    return { ...v, sliceBy: { key } };
  }
  return v;
}

/** Every value slot of one view, with `bound` replaced by a COPY of the fixed value — a copy
 *  per slot, so a later edit to one series does not move the next one. */
function refixView(v, value) {
  if (!isObj(v)) return v;
  const fix = (x) => (isBound(x) ? structuredClone(value) : x);
  if (v.kind === 'chart') {
    return { ...v, series: arr(v.series).map((s) => {
      if (!isObj(s) || s.kind !== 'value') return s;
      const out = { ...s, value: fix(s.value) };
      if (isObj(s.guide) && hasOwn(s.guide, 'value')) out.guide = { ...s.guide, value: fix(s.guide.value) };
      return out;
    }) };
  }
  if (v.kind === 'table') {
    const out = { ...v, columns: arr(v.columns).map((c) => (isObj(c) ? { ...c, value: fix(c.value) } : c)) };
    if (isObj(v.share) && isObj(v.share.value)) out.share = { value: fix(v.share.value) };
    return out;
  }
  if (v.kind === 'kpi') {
    const out = { ...v, value: fix(v.value) };
    if (isObj(v.target)) out.target = { ...v.target, value: fix(v.target.value) };
    return out;
  }
  if (v.kind === 'pie') return { ...v, value: fix(v.value) };
  return v;
}

/* ── what a chip has to NAME before it changes the draft (§9: nothing silent) ──
   Two questions, both asked before a mutation that TAKES something away, and both answered
   by a confirm that names what goes. They live HERE rather than in the builder because the
   mutator that removes them is here: one definition of «what follows the switch» and «what
   reads CM360», or the sentence and the deletion drift apart. */

/** What this element is CALLED — the typed label when its author gave it one, else the name
 *  §2 derives from the value it holds. A `bound` value resolves through the switch's own
 *  default, which is what the card beside the confirm is printing right now. */
const nameOf = (el, value, spec) => (
  (isObj(el) && el.labelAuto === false && el.label)
    ? el.label
    : (autoLabel(resolveValue(value, spec, null)) || '')
);

/**
 * boundElements(spec) → every value slot that FOLLOWS the metric switch, in render order:
 * `[{viewId, kind, elementId, label}]`, `kind` one of
 * `series | guide | column | value | target`.
 *
 * The same slots `refixView` rewrites, read rather than written — so the confirm that
 * precedes «remove the metric switch» names exactly the elements that mutation will re-fix.
 * (The grammar's walk has one more, a switch OPTION, and `normControl` refuses a bound one:
 * bound is what the switch resolves TO.) A guide has no id of its own; it is named by the
 * series that carries it.
 */
export function boundElements(spec) {
  const out = [];
  for (const v of flattenViews(views(spec))) {
    if (!isObj(v)) continue;
    const push = (kind, elementId, el, value) => {
      if (isBound(value)) out.push({ viewId: v.id, kind, elementId, label: nameOf(el, value, spec) });
    };
    for (const s of arr(v.series)) {
      if (!isObj(s)) continue;
      push('series', s.id, s, s.value);
      if (isObj(s.guide)) push('guide', s.id, s, s.guide.value);
    }
    for (const c of arr(v.columns)) if (isObj(c)) push('column', c.id, c, c.value);
    if (isObj(v.share)) push('share', v.id, null, v.share.value);
    push('value', v.id, null, v.value);
    if (isObj(v.target)) push('target', v.id, null, v.target.value);
  }
  return out;
}

/** What an untitled view is called in that list. The builder has a richer answer (`viewName`
 *  numbers two untitled charts apart), and it lives in a React module this one may not
 *  import — so the caller relabels when it has one, and this is the honest fallback. Only
 *  `container` of the three composition kinds (VIEW_KINDS beyond the five classic ones) is
 *  ever read here — a bound-value formula error traces back through a switch option to a
 *  chart/table/kpi/pie/compare view or a container's badge, never to an atom's or a Layout's
 *  own bind, which carries no `kind: 'bound'` shape (`normLayoutBind`, shared/report-v2.js)
 *  and so never enters that trace. */
const KIND_WORD = { __proto__: null, chart: 'Chart', table: 'Table', kpi: 'KPI', pie: 'Pie', compare: 'Compare',
  container: 'Container' };

/**
 * dimensionGrains(spec) → every GRAIN slot that follows the dimension switch, in render
 * order: `[{viewId, kind, label}]`, `kind` one of `x | rows | sliceBy`.
 *
 * `boundElements` one slot over, and for the same reason: the confirm that precedes «remove
 * the dimension switch» has to name exactly the slots `refixGrain` is about to rewrite, or
 * the sentence and the deletion drift apart. The label is the VIEW's own name — a grain has
 * no name of its own, and the card is what the author is looking at.
 */
export function dimensionGrains(spec) {
  const out = [];
  const followed = (g) => isObj(g) && g.type === 'control';
  for (const v of flattenViews(views(spec))) {
    if (!isObj(v)) continue;
    const label = v.title || KIND_WORD[v.kind] || v.kind;
    if (v.kind === 'chart' && followed(v.x)) out.push({ viewId: v.id, kind: 'x', label });
    if (v.kind === 'table' && followed(v.rows)) out.push({ viewId: v.id, kind: 'rows', label });
    if (v.kind === 'pie' && isObj(v.sliceBy) && hasOwn(v.sliceBy, 'controlId')) {
      out.push({ viewId: v.id, kind: 'sliceBy', label });
    }
  }
  return out;
}

/**
 * A stored value that is READ FROM the CM360 aux file. Two shapes since 2026-09-16, and one
 * predicate for both, because «remove the CM360 source» has to NAME every element that goes
 * and then remove exactly those:
 *   · a `cm` metric — Table B's own rule, the source is on the value;
 *   · a FORMULA that names one of the three CM360 identifiers (§2.10), or carries a CM360
 *     chip (formula chips P0) — the source is in the identifier or the chip, which is why a
 *     formula carries no `source` key and never gained one. `isCmBearing` is asked about the
 *     HOLDER, never its text, so a chip map is read wherever the text was.
 * A canonical metric is delivery-only by shape and is neither.
 *
 * Edited HERE and nowhere else: `cmElements` reads it, `dropCmElements`'s four arms (chart,
 * table, kpi, pie) read it, and `dropCmOptions` reads it. A second «and also formulas» walk
 * beside them is how the confirm ends up naming three elements and removing two.
 */
const isCmValue = (v) => isObj(v)
  && ((v.kind === 'metric' && v.source === 'cm') || (v.kind === 'formula' && isCmBearing(v)));
/** A highlight rule naming CM360 in any of the four slots `checkAlerts` judges (§2.8). */
const cmBearingRule = (rules) => arr(rules).some((r) => isObj(r) && [r.input, r.guard,
  isObj(r.condition) ? r.condition.threshold : null, isObj(r.condition) ? r.condition.upper : null]
  .some((slot) => isObj(slot) && isCmBearing(slot)));
/** The rule out, the owner untouched: the number a column or series draws is not the rule's,
 *  and an author removing the CM360 source still wants the column. The last rule leaving
 *  takes the key with it rather than storing an empty list; the grammar would accept the
 *  empty list too, but a key nobody wrote is not left standing on its way out. */
const dropCmRules = (node) => {
  if (!isObj(node) || !cmBearingRule(node.highlights)) return node;
  const kept = arr(node.highlights).filter((r) => !cmBearingRule([r]));
  const next = { ...node };
  if (kept.length) next.highlights = kept; else delete next.highlights;
  return next;
};

/** A Layout BINDING or mini-chart LINE that reads it. A block carries no `source` key and no
 *  value union, so the identifiers inside its formula, or the chips beside it, are the whole
 *  of the question (§2.1). A line is its own holder (`{id, label, expr, chips?}`). */
const isCmBind = (b) => isObj(b) && isCmBearing(b);
/** The plain word a block's TYPE prints when its own label is absent. Clearing the field
 *  DELETES the key (LayoutCard.jsx:160), it does not blank it, so an unlabelled block is
 *  ordinary editing, not a corrupt draft — and the word it wears has to be one a reader
 *  chose, never the raw JSON type and never a node id, neither of which means anything to
 *  someone deciding whether to press "Remove them". */
const BRICK_TYPE_WORD = { __proto__: null,
  bigStat: 'stat', meter: 'meter', pill: 'pill', statRow: 'stat row', header: 'heading',
  miniChart: 'mini chart', detailCard: 'detail card', unitBars: 'delivery bars', gauge: 'gauge',
  moneyStat: 'money', kvRow: 'label and value', rateRows: 'rate rows', progressBar: 'progress bar',
  flightBullet: 'flight', note: 'note' };
const brickName = (brick) => brick.label || BRICK_TYPE_WORD[brick.type] || brick.type;
/**
 * Everything inside ONE block that reads CM360, named the way the author sees it.
 *
 * Three labels, and they are the three the spec names (§2.7): the BLOCK, a stat-row CELL and
 * a mini-chart LINE. The block's own value, its target and its progress marker collapse into
 * one entry, because all three are parts of that block and removing any of them is a change
 * to it: two entries wearing the same name would read as one thing listed twice.
 *
 * An unlabelled cell or line carries no id of its own worth showing (a node id is not a word
 * the author chose), so it is counted among its siblings instead — "cell 2", "line 1" — the
 * position being the only fact the author still has to go on.
 */
/** Does the block's own bind, target or tick read CM360 — the condition `cmBrickLabels` names
 *  the block on, and the same condition the highlight loop below checks before naming the
 *  block a second time: a cm-bearing rule on a block whose own value already got it a brick
 *  entry folds into that entry instead of opening a second one under the same word. */
const brickOwnValueIsCm = (brick) => isCmBind(brick.bind) || isCmBind(brick.target) || isCmBind(brick.tick);
function cmBrickLabels(brick) {
  if (!isObj(brick)) return [];
  const name = brickName(brick);
  const out = [];
  if (brickOwnValueIsCm(brick)) out.push(name);
  arr(brick.cells).forEach((cell, i) => { if (isObj(cell) && isCmBind(cell.bind)) out.push(cell.label || `cell ${i + 1}`); });
  arr(brick.series).forEach((line, i) => { if (isCmBind(line)) out.push(line.label || `line ${i + 1}`); });
  return out;
}
/** A cm-bearing highlight RULE living on the block itself, a stat-row cell or a mini-chart
 *  line. None of the three is reached by the series/column highlight scan below — a Layout
 *  node carries no `series` and no `columns` of its own for that scan to walk — so a rule
 *  here would survive «remove the source» as dead config unless it is asked for on its own.
 *  The cheap pre-gate in front of `brickIn`'s per-owner walk: a block carrying no cm rule
 *  anywhere — the ordinary case — answers in one pass and the walk never runs. */
const brickHasCmHighlight = (brick) => isObj(brick) && (cmBearingRule(brick.highlights)
  || arr(brick.cells).some((cell) => isObj(cell) && cmBearingRule(cell.highlights))
  || arr(brick.series).some((line) => isObj(line) && cmBearingRule(line.highlights)));
/**
 * Does `dropCmBrick` delete this block WHOLE? Every shape it answers `null` for, in its own
 * order: the block's own value is the cm one, a required target is (a meter and a gauge draw a
 * distance, and a distance from nothing is not a picture), every cell goes, every line goes.
 *
 * It is the gate the highlight naming stands on. A rule on a block that is LEAVING goes with
 * it and is named once, as the brick; a rule on a block that STAYS survives the drop's own
 * `dropCmRules` pass and has to be named on its own, or the confirm promises less than the
 * removal takes. Read against `dropCmBrick`: the two list the same shapes, and a shape added
 * there without one here is a highlight named twice.
 */
/** The two block types `normLayoutValueFields` refuses without a target (report-v2.js
 *  `needsTarget`): both DRAW a distance, and a distance from nothing is not a picture. So a
 *  cm target cannot simply be lifted off one, the way it can off a bigStat. */
const TARGET_REQUIRED = new Set(['meter', 'gauge']);
const brickLeavesWhole = (brick) => {
  if (!isObj(brick)) return false;
  if (isCmBind(brick.bind)) return true;
  if (isCmBind(brick.target) && TARGET_REQUIRED.has(brick.type)) return true;
  const cells = arr(brick.cells);
  if (cells.length && cells.every((cell) => isObj(cell) && isCmBind(cell.bind))) return true;
  const series = arr(brick.series);
  return series.length > 0 && series.every((line) => isCmBind(line));
};

/**
 * cmElements(spec) → everything in this draft that only exists because the dataset is
 * CM360: `[{viewId, kind, elementId, label}]`, `kind` one of
 * `series | guide | column | delta | value | target | share | deltaKpi | option | compare |
 * breakdown | brick | highlight`.
 *
 * Seven rails, in the grammar's own words: a `cm` VALUE reads the aux file (Table B, and a
 * table's row SHARE is the same reading, §2.6), a Δ% COLUMN subtracts CM360 from delivery, a
 * KPI's Δ line measures against it, a COMPARE view is the comparison, a BREAKDOWN control
 * picks the mapping's dimensions, a Layout BRICK prints a CM360 number (§2.7), and a
 * cm-bearing HIGHLIGHT rule paints one (§2.8). Each of those is refused outright on a
 * delivery dataset, so «remove the source» has to say which of them go with it.
 *
 * A switch OPTION is a value slot like any other — the grammar's own walk counts it beside a
 * series and a column («a series, a guide, a column, a KPI, a target, a pie and a switch
 * option each hold one»), and the direct rail refuses a `cm` one on delivery. The builder's
 * own metric panel mints every option from the `bq` side today, so nothing it authors lands
 * here; a widget that carries one anyway must still be named rather than quietly edited.
 *
 * A series whose own value is cm is listed ONCE: its guide leaves with it, and a column
 * carries its plan away the same way.
 */
export function cmElements(spec) {
  const out = [];
  for (const v of flattenViews(views(spec))) {
    if (!isObj(v)) continue;
    if (v.kind === 'compare') {
      out.push({ viewId: v.id, kind: 'compare', elementId: v.id, label: v.title || '' });
      continue;
    }
    const viewLabel = () => v.title || nameOf(null, v.value, spec);
    for (const s of arr(v.series)) {
      if (!isObj(s)) continue;
      if (isCmValue(s.value)) out.push({ viewId: v.id, kind: 'series', elementId: s.id, label: nameOf(s, s.value, spec) });
      else if (isObj(s.guide) && isCmValue(s.guide.value)) {
        out.push({ viewId: v.id, kind: 'guide', elementId: s.id, label: nameOf(s, s.value, spec) });
      }
    }
    for (const c of arr(v.columns)) {
      if (!isObj(c)) continue;
      if (c.kind === 'delta') out.push({ viewId: v.id, kind: 'delta', elementId: c.id, label: nameOf(c, c.value, spec) });
      else if (isCmValue(c.value)) out.push({ viewId: v.id, kind: 'column', elementId: c.id, label: nameOf(c, c.value, spec) });
      // A column's PLAN reads CM360 on its own terms and survives its column (fix round 1) —
      // the KPI target's twin four lines down, and the same word for it: «the target on X».
      // Listed only where the column itself stays, so one element is never named twice.
      else if (isObj(c.target) && isCmValue(c.target.value)) {
        out.push({ viewId: v.id, kind: 'target', elementId: c.id, label: nameOf(c, c.value, spec) });
      }
    }
    if (isObj(v.share) && isCmValue(v.share.value)) {
      out.push({ viewId: v.id, kind: 'share', elementId: v.id, label: nameOf(null, v.share.value, spec) });
    }
    if (isCmValue(v.value)) out.push({ viewId: v.id, kind: 'value', elementId: v.id, label: viewLabel() });
    if (isObj(v.target) && isCmValue(v.target.value)) {
      out.push({ viewId: v.id, kind: 'target', elementId: v.id, label: viewLabel() });
    }
    if (v.deltaVsOtherSource === true) {
      out.push({ viewId: v.id, kind: 'deltaKpi', elementId: v.id, label: viewLabel() });
    }
    // The Layout roots (§2.7). A block never enters the value walk above, so it is asked for
    // separately, at the three places the grammar puts one: an atom's `brick`, a Layout
    // view's `rows`, a container's `badge`. `elementId` is the NODE's, because a block has no
    // id of its own; the label is what tells two blocks of one Layout apart.
    const brickAt = (label) => out.push({ viewId: v.id, kind: 'brick', elementId: v.id, label });
    // A cm-bearing HIGHLIGHT on a block, a cell or a mini-chart line is its own rail (§2.8),
    // beside the block's own value: run through `brickIn` once per brick so neither scan is
    // repeated by hand at each of the three places a brick lives.
    const brickIn = (brick) => {
      const labels = cmBrickLabels(brick);
      for (const label of labels) brickAt(label);
      // A block the drop deletes WHOLE takes its rules with it, and `labels` has already named
      // it — a second entry would list one element twice. A block that STAYS keeps every slot
      // the drop does not take, so each surviving owner of a cm-bearing rule is named on its
      // own, in the same label convention `cmBrickLabels` uses — except the block itself, whose
      // rule folds into its existing brick entry when `labels` already named it (see below). A
      // cell or line that is itself leaving is not named again here; its rule goes with it and
      // its own entry is up above.
      if (!isObj(brick) || brickLeavesWhole(brick) || !brickHasCmHighlight(brick)) return;
      const highlightAt = (label) => out.push({ viewId: v.id, kind: 'highlight', elementId: v.id, label });
      // A block whose own bind/target/tick is cm-bearing already got a brick entry above under
      // this same name; a rule on that same block is not a second thing to name, it folds into
      // that one entry (§ruling 2026-09-18). Only a block that survives with an untouched own
      // value — cmBrickLabels named nothing for it — gets its rule named here on its own.
      if (cmBearingRule(brick.highlights) && !brickOwnValueIsCm(brick)) highlightAt(brickName(brick));
      arr(brick.cells).forEach((cell, i) => {
        if (isObj(cell) && !isCmBind(cell.bind) && cmBearingRule(cell.highlights)) {
          highlightAt(cell.label || `cell ${i + 1}`);
        }
      });
      arr(brick.series).forEach((line, i) => {
        if (isObj(line) && !isCmBind(line) && cmBearingRule(line.highlights)) {
          highlightAt(line.label || `line ${i + 1}`);
        }
      });
    };
    brickIn(v.brick);
    let colAt = 0;
    for (const row of arr(v.rows)) {
      for (const column of arr(row && row.cols)) {
        colAt++;
        for (const brick of arr(column && column.bricks)) brickIn(brick);
        // A column with no title of its own is named by its POSITION, with the Layout's own
        // title beside it when there is one. Never the Layout's title ALONE: an untitled
        // Layout is the rarer case, and falling back to it first gave every badge-bearing
        // column of one titled Layout the identical word — the repetition this fallback was
        // written to prevent, arrived at from the other side.
        if (isObj(column) && isCmBind(column.badge && column.badge.bind)) {
          const where = `badge on column ${colAt}`;
          brickAt(column.title || (v.title ? `${where} of ${v.title}` : where));
        }
      }
    }
    if (isCmBind(v.badge && v.badge.bind)) brickAt(v.title || KIND_WORD[v.kind] || v.kind);
    // A highlight PAINTS a number it does not own (§2.8), so it is listed BESIDE its owner
    // and the owner is what the confirm names. An owner that is itself leaving is not listed
    // twice: its rules go with it.
    for (const s of arr(v.series)) {
      if (isObj(s) && !isCmValue(s.value) && cmBearingRule(s.highlights)) {
        out.push({ viewId: v.id, kind: 'highlight', elementId: s.id, label: nameOf(s, s.value, spec) });
      }
    }
    for (const c of arr(v.columns)) {
      if (isObj(c) && c.kind !== 'delta' && !isCmValue(c.value) && cmBearingRule(c.highlights)) {
        out.push({ viewId: v.id, kind: 'highlight', elementId: c.id, label: nameOf(c, c.value, spec) });
      }
    }
    if (!isCmValue(v.value) && cmBearingRule(v.highlights)) {
      out.push({ viewId: v.id, kind: 'highlight', elementId: v.id, label: viewLabel() });
    }
  }
  for (const c of controls(spec)) {
    if (!isObj(c)) continue;
    if (c.type === 'metric') {
      for (const o of arr(c.options)) {
        if (isObj(o) && isCmValue(o.value)) {
          out.push({ viewId: null, kind: 'option', elementId: o.id, label: nameOf(o, o.value, spec) });
        }
      }
    }
    if (c.type === 'breakdown') {
      out.push({ viewId: null, kind: 'breakdown', elementId: c.id, label: c.label || '' });
    }
  }
  return out;
}

/**
 * One metric switch with its `cm` options taken out. The switch itself STAYS: it is legal on
 * a delivery report and the author may still tick a replacement, so removing it would be the
 * silent decision §9 forbids — under two options the grammar names it, exactly as it names a
 * switch the Compare view left with no consumer.
 */
function dropCmOptions(c) {
  if (!isObj(c) || c.type !== 'metric') return c;
  const options = arr(c.options);
  const kept = options.filter((o) => !(isObj(o) && isCmValue(o.value)));
  if (kept.length === options.length) return c;
  const next = { ...c, options: kept };
  // A default naming an option that just left is not a choice the author still has, and they
  // never chose to lose it — the metric panel's own rule for an untick.
  if (!kept.some((o) => isObj(o) && o.id === c.defaultOptionId)) {
    if (kept.length) next.defaultOptionId = kept[0].id; else delete next.defaultOptionId;
  }
  return next;
}

/**
 * dropCmElements(spec) — the draft with every one of the above taken out, and the two
 * things that DANGLE behind them: a sort naming a Δ% column that is gone, and a wire naming
 * a view that is gone. It does NOT touch the dataset: the caller writes that, because the
 * widget's `datasetType` discriminator lives beside the spec and moves with it.
 *
 * A view whose ONLY series or ONLY columns read CM360 has nothing left to draw, so the view
 * goes too — and a report left with no view at all is refused BY NAME (§9) rather than
 * repaired, which is what the confirm in front of this said would happen. A metric switch
 * left under two options by the same pass is the same case, and stays for the same reason.
 *
 * Nothing to drop returns the SAME spec, so a no-op edit never reads as dirty.
 */
export function dropCmElements(spec) {
  if (!cmElements(spec).length) return spec;
  /**
   * One block, with every cm-bearing slot taken out (§2.7). `null` means the block itself
   * cannot survive the removal: its own VALUE was the cm one, or what is left is a shape the
   * Layout grammar refuses (an empty stat row, an empty mini chart, a meter with no target).
   * Written here rather than in the grammar because it is an EDIT, and the grammar judges.
   *
   * A cm-bearing highlight RULE (§2.8) is its own removal, on the block itself and on each
   * surviving cell and mini-chart line: `cmElements` names each of those owners while the
   * block stands (`brickLeavesWhole` is the shared gate), and the confirm in front of this
   * promised to take away exactly what it named — a rule left behind, on a block the drop
   * otherwise keeps whole, would survive as dead config nothing points at any more, and a
   * later `cmElements` pass would still name it.
   */
  const dropCmBrick = (brick) => {
    if (!isObj(brick)) return brick;
    if (isCmBind(brick.bind)) return null;
    let next = dropCmRules(brick);
    if (isCmBind(next.target)) {
      if (TARGET_REQUIRED.has(next.type)) return null;
      // `invert` exists only beside a target, so it leaves with it or the block is refused.
      const { target, invert, ...rest } = next;
      next = rest;
    }
    if (isCmBind(next.tick)) {
      // …and a marker label with no marker is the same refusal, one key over.
      const { tick, tickLabel, tickFormat, ...rest } = next;
      next = rest;
    }
    if (arr(next.cells).length) {
      const cells = arr(next.cells)
        .filter((c) => !(isObj(c) && isCmBind(c.bind)))
        .map(dropCmRules);
      if (!cells.length) return null;
      if (cells.length !== next.cells.length || cells.some((c, i) => c !== next.cells[i])) {
        next = { ...next, cells };
      }
    }
    if (arr(next.series).length) {
      const series = arr(next.series)
        .filter((s) => !isCmBind(s))
        .map(dropCmRules);
      if (!series.length) return null;
      if (series.length !== next.series.length || series.some((s, i) => s !== next.series[i])) {
        next = { ...next, series };
      }
    }
    return next;
  };
  const dropLeaf = (v) => {
    if (!isObj(v)) return v;
    if (v.kind === 'compare') return null;
    if (v.kind === 'atom') {
      const brick = dropCmBrick(v.brick);
      return brick ? (brick === v.brick ? v : { ...v, brick }) : null;
    }
    if (v.kind === 'layout') {
      // Upward, inside the view: a column with no blocks, a row with no columns and a Layout
      // with no rows are three refusals, so the emptiness is followed as far as it reaches.
      let changed = false;
      const rows = [];
      for (const row of arr(v.rows)) {
        const cols = [];
        for (const column of arr(row && row.cols)) {
          const bricks = [];
          for (const brick of arr(column && column.bricks)) {
            const kept = dropCmBrick(brick);
            if (kept !== brick) changed = true;
            if (kept) bricks.push(kept);
          }
          let next = column;
          if (isObj(column) && isCmBind(column.badge && column.badge.bind)) {
            const { badge, ...rest } = column;
            next = rest;
            changed = true;
          }
          if (bricks.length) cols.push({ ...next, bricks });
          else changed = true;
        }
        if (cols.length) rows.push({ cols });
        else changed = true;
      }
      if (!rows.length) return null;
      return changed ? { ...v, rows } : v;
    }
    if (v.kind === 'container') {
      if (!isCmBind(v.badge && v.badge.bind)) return v;
      // `hideBadge` is deliberately left standing here, unlike `target`/`invert` and
      // `tick`/`tickLabel` above: every reader of it (ReportComposition.jsx, CompositionEditor,
      // LayoutCard's own select) guards on `badge` being present first, so a `hideBadge` with
      // no `badge` beside it is inert rather than a corrupt draft — the UI's own "No badge"
      // pick clears both keys together, but this programmatic drop only owes the one the CM360
      // source put there.
      const { badge, ...rest } = v;
      return rest;
    }
    if (v.kind === 'chart') {
      const series = arr(v.series).filter((s) => !(isObj(s) && isCmValue(s.value)));
      if (!series.length) return null;
      return { ...v, series: series.map((s) => {
        const kept = dropCmRules(s);
        if (!isObj(kept) || !isObj(kept.guide) || !isCmValue(kept.guide.value)) return kept;
        const { guide, ...rest } = kept;
        return rest;
      }) };
    }
    if (v.kind === 'table') {
      const goes = (c) => isObj(c) && (c.kind === 'delta' || isCmValue(c.value));
      const columns = arr(v.columns).filter((c) => !goes(c)).map((c) => {
        const kept = dropCmRules(c);
        if (!isObj(kept) || !isObj(kept.target) || !isCmValue(kept.target.value)) return kept;
        const { target, ...rest } = kept;
        return rest;
      });
      if (!columns.length) return null;
      const next = { ...v, columns };
      const dropped = new Set(arr(v.columns).filter(goes).map((c) => c.id));
      if (isObj(v.sort) && dropped.has(v.sort.columnId)) delete next.sort;
      if (isObj(v.share) && (dropped.has(v.share.columnId) || isCmValue(v.share.value))) delete next.share;
      if (!next.share && next.sort?.columnId === '__share__') delete next.sort;
      return tableOrder(next);
    }
    if (v.kind === 'kpi') {
      if (isCmValue(v.value)) return null;
      const next = { ...dropCmRules(v), deltaVsOtherSource: false };
      if (isObj(v.target) && isCmValue(v.target.value)) delete next.target;
      return kpiOrder(next);
    }
    if (v.kind === 'pie' && isCmValue(v.value)) return null;
    return dropCmRules(v);
  };
  /**
   * The last prune, and it has to be a second pass: `mapViewTree` maps a node BEFORE its
   * children, so a container cannot know it has been emptied until they have all been mapped.
   * A container with no children is a refusal (§2.7), and an atom whose block just left is
   * exactly how one comes to be empty.
   */
  const pruneEmpty = (list, depth = 1) => {
    if (depth > LIMITS.compositionDepth) return list;
    const out = [];
    for (const node of arr(list)) {
      if (isObj(node) && node.kind === 'container') {
        const children = pruneEmpty(node.children, depth + 1);
        if (!children.length) continue;
        out.push(children === node.children ? node : { ...node, children });
        continue;
      }
      out.push(node);
    }
    return out.length === arr(list).length && out.every((n, i) => n === list[i]) ? list : out;
  };
  const keptViews = pruneEmpty(mapViewTree(views(spec), dropLeaf));
  const alive = new Set(flattenViews(keptViews).filter(isObj).map((v) => v.id));
  const out = {
    ...spec,
    controls: controls(spec)
      .filter((c) => !(isObj(c) && c.type === 'breakdown'))
      .map(dropCmOptions),
    views: keptViews,
  };
  if (hasOwn(spec, 'interactions')) {
    out.interactions = arr(spec.interactions)
      .filter((it) => isObj(it) && alive.has(it.sourceViewId) && alive.has(it.targetViewId));
  }
  // The fourth mutator that can change which view is LAST, and it drops the row mark for the
  // same reason the other three do: a compare view taken out from under a marked neighbour
  // would otherwise leave a spec the grammar refuses, behind a confirm that promised to take
  // CM360 elements away and nothing else.
  return noStrandedBeside(out);
}

/**
 * A DUAL-SOURCE field stored under its CM name, minted back under the engine's own key —
 * `{metric:'impressions'}` → `{metric:'im'}` — or the value unchanged.
 *
 * `mintValue` stores the CM NAME on BOTH sides of a `deliveryCm360` widget so that the two
 * halves of a comparison describe one population (metric-catalog's own rule). Off that
 * dataset there is no CM360 adapter to feed it and the engine has no field called
 * `impressions`, so the tile prints «Unknown field "impressions"» under a card that still
 * calls the row Impressions — and the draft is VALID, so it saves that way.
 */
const backToDelivery = (v) => {
  if (!isObj(v) || v.kind !== 'metric' || v.source !== 'bq') return v;
  const entry = entryOf(v, 'deliveryCm360');
  if (!entry || !entry.cmName || entry.cmName !== v.metric) return v;
  return mintValue(entry, { source: 'bq', datasetType: 'delivery' });
};

/**
 * remintForDelivery(spec) — the draft with every dual-source value spelled the way the
 * DELIVERY engine spells it (see `backToDelivery`).
 *
 * It is the other half of «remove the CM360 source», and it is separate from
 * `dropCmElements` because it applies on BOTH ways out: a report whose only CM360 tie is
 * the dataset itself has nothing for that mutator to drop and returns the same spec, while
 * its values are spelled `impressions` all the same. The confirm in front of this promises
 * to take away what READS CM360; an impression count is not that, so it comes back rather
 * than being deleted or left broken.
 *
 * Every value slot the grammar has, switch options included — a bound element reads its
 * number through the switch, so an option left spelled `impressions` breaks every element
 * that follows it. Nothing to re-mint returns the SAME spec, so a no-op never reads as dirty.
 */
export function remintForDelivery(spec) {
  if (!isObj(spec)) return spec;
  let moved = false;
  const val = (v) => { const next = backToDelivery(v); if (next !== v) moved = true; return next; };
  // The spread keeps each key where it was: `value` already exists on every object below,
  // so writing it back changes the object's contents and never its order.
  const slot = (o, key) => (isObj(o) && hasOwn(o, key) ? { ...o, [key]: val(o[key]) } : o);
  const nextViews = mapViewTree(views(spec), (v) => {
    if (!isObj(v)) return v;
    let out = slot(v, 'value');
    if (arr(v.series).length) {
      out = { ...out, series: arr(v.series).map((s) => {
        if (!isObj(s)) return s;
        const next = slot(s, 'value');
        if (!isObj(s.guide)) return next;
        const guide = slot(s.guide, 'value');
        return guide === s.guide ? next : { ...next, guide };
      }) };
    }
    if (arr(v.columns).length) out = { ...out, columns: arr(v.columns).map((c) => slot(c, 'value')) };
    if (isObj(v.share)) out = { ...out, share: slot(v.share, 'value') };
    if (isObj(v.target)) out = { ...out, target: slot(v.target, 'value') };
    return out;
  });
  const nextControls = controls(spec).map((c) => (isObj(c) && c.type === 'metric' && arr(c.options).length
    ? { ...c, options: arr(c.options).map((o) => slot(o, 'value')) }
    : c));
  if (!moved) return spec;
  // Only the keys that were there: a spec is written back with the keys it arrived with,
  // and minting `controls: []` onto one that carries none would be this function inventing
  // a shape the grammar then judges.
  const out = { ...spec };
  if (hasOwn(spec, 'controls')) out.controls = nextControls;
  if (hasOwn(spec, 'views')) out.views = nextViews;
  return out;
}

/**
 * setDataset(spec, dataset) — `{type:'delivery'}` or `{type:'deliveryCm360', mapping}`.
 *
 * It writes the dataset and nothing else. The widget's `datasetType` discriminator lives
 * BESIDE the spec and the builder sets it from `derivedDatasetType`; the values already in
 * the draft are not re-minted, and the Period control a CM360 dataset forbids is not deleted —
 * both are named by the validator as a context conflict, with Fix or Undo (§9).
 */
export function setDataset(spec, dataset) {
  const d = isObj(dataset) ? dataset : {};
  if (d.type !== 'deliveryCm360') return { ...spec, dataset: { type: 'delivery' } };
  const m = isObj(d.mapping) ? d.mapping : { mode: 'runtime' };
  const mapping = m.mode === 'fixed' ? { mode: 'fixed', id: m.id } : { mode: 'runtime' };
  return { ...spec, dataset: { type: 'deliveryCm360', mapping } };
}

/** The widget's own period (§6): a RangeValue, or null for «follows the dashboard filter».
 *  Nothing chosen IS null — the key is required, and an absent one is a client that forgot
 *  to say rather than a widget that follows the filter. */
export function setPeriod(spec, value) {
  return { ...spec, period: value == null ? null : value };
}

/** Declare a cross-view wire (§5.6): focusing a Compare row filters the chart beside it.
 *  One type today, and it is stored from the input so a second one arrives on purpose. */
export function addInteraction(spec, interaction) {
  const it = isObj(interaction) ? interaction : {};
  const id = isNodeId(it.id) ? it.id : newNodeId(spec, 'ix');
  const body = {
    id,
    type: pick(it, 'type', 'tupleFocus'),
    sourceViewId: it.sourceViewId,
    targetViewId: it.targetViewId,
  };
  return { ...spec, interactions: [...arr(spec && spec.interactions), body] };
}

export function removeInteraction(spec, interactionId) {
  const list = arr(spec && spec.interactions);
  if (!list.some((it) => isObj(it) && it.id === interactionId)) return spec;
  return { ...spec, interactions: list.filter((it) => !(isObj(it) && it.id === interactionId)) };
}
