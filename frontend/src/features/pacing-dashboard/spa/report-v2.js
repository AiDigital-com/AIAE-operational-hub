// workspace/src/lib/dashboard/report-v2.js
//
// The workspace's door onto @shared/report-v2 — the CLOSED wire grammar of a v2
// report widget (widget-builder v2 spec 2026-08-19). Nothing in the app imports
// the UMD directly; this is the one place the client reads the grammar from,
// exactly as library-refs.js is for library links and display-blocks.js is for
// display.enabled.
//
// Everything below is re-exported, not re-implemented: dash-gate validates a
// stored spec with this same module, and a second definition of "which view kinds
// exist" or "which families add up" is how a renderer draws a widget the server
// would never have accepted — or refuses one it did.
//
// The tables arrive FROZEN from the UMD. They are shared with the server's own
// module inside this process; nothing here may push onto one.
import ReportV2 from '@shared/report-v2';

// The READ half (P2): the tables a renderer dispatches a stored spec on.
// The AUTHORING half (P3 Task 0): what a draft is written and checked against —
//   UNIT_FAMILIES  the family vocabulary a format picker offers from, and the one a
//                  hand-typed formula has to declare;
//   FLOW_FIELDS    the window totals §7.2 refuses as a guide on a date chart, so the
//                  Spotlight can say so instead of the save saying it;
//   NODE_ID_RE / isNodeId  the shape a newly minted view/series/column id must have;
//   formatLegal    which cell formats a family prints;
//   normValue / normLabel / normControls  the pieces the draft validator runs ONE edit
//                  through, without normalizing the whole spec on every keystroke;
//   CONTROL_TYPES  the STORED order of the control list, which the builder's draft is
//                  written in — an author's order would come back re-ordered from PG and
//                  read as dirty;
//   emptyReport    the newborn (spec §3), minted beside the normalizer that accepts it.
// The CHART half (P3 Task 6): the eleven vocabularies the chart card and its two popovers
//   FILL their pickers from — X_TYPES (the grains a chart's X may take, which is what keeps
//   the table-only `dateLi` off it), ORIENTATIONS, CHART_FORMATS (the two axis scales), AXES,
//   ACCUMULATE_MODES, STYLE_TYPES / STROKE_WIDTHS / CURVES / AREA_FILLS / BAR_MODES (Table F,
//   per style type) and CALC_KINDS. A picker filled from a re-typed list offers a value the
//   grammar refuses, and the author reads the refusal after the save instead of before the pick.
// The TABLE half (P3 Task 7): ROW_TYPES (the grains a table runs down — one more than a
//   chart's X, which is where `dateLi` lives), DELTA_ROW_TYPES (decision 12's whitelist: the
//   grains a Δ% column may sit on), COLUMN_KINDS and SORT_DIRS. Same rule, same reason.
//   Both grain lists gained `control` with the dimension switch (sections-to-widgets M4):
//   the slot names a CONTROL instead of a key, and the viewer picks the cut. The pickers
//   read the same lists, so the row that offers it appears in both maps by itself.
// The BUILDER half (P3 Task 9) is one sentence: `CM_NO_SPEC_PERIOD`, the grammar's own
//   refusal for a CM360 widget's Data period. The Data row's chip is disabled on one and has
//   to print the reason, and `normReport` is fail-fast — on a draft broken earlier it never
//   reaches that line to be asked. One constant, so the chip and the save answer alike.
//   Beside it, since 2026-08-26, `SWITCH_NO_SPEC_PERIOD`, forwarded for the same reason and
//   one more: §6's precedence says a Period switch beats the widget's own window, so the two
//   together are refused, and the BUILDER asks that question before the write on two doors —
//   minting a switch over a fixed window, and pinning a window under a switch. Both confirms
//   are about the grammar's own rule, so the rule has one wording and the save cannot answer
//   with a second one.
//   Beside it, since T16, `POINTER_SEP`: what `fail` puts between a refusal's pointer and its
//   sentence. `report-draft.js` splits the pointer back off to name the element a refusal is
//   about, so the joiner and the splitter have to be the same string, not two copies of it.
// The VALUE-SOURCES half (phase 1, spec 2026-08-25): `specWantsCm` — does this spec hold a
//   `source:'cm'` value anywhere a value lives — is the grammar's own Table I walk, and the
//   read path's fetch gate reads it from here rather than re-walking the seven slots: a tile
//   that fetched CM by a second reading of the spec would fetch for widgets the validator's
//   `CM_NO_ENTITY_SCOPE` rail judges by the first one. `CM_NO_ENTITY_SCOPE` rides along for
//   the same reason the Layout sentences do — one wording for the refusal and for the
//   affordance that has to print it.
// The KPI half (section-widget parity, 2026-09-04) forwards ONE list, `KPI_BASES`, and its
//   consumer is `kpi-basis.js` — the module that answers, for a real pacing, which line items
//   each basis names and whether it has any. A basis added to the grammar with no resolver
//   beside it would hide a cell the server happily stores, so the resolver reads the grammar's
//   own list and a test holds the two together. Density, target corridors and column zero
//   display choices also feed the same pickers on every nested inspector.
// The ROW half (section view rows, spec 2026-08-27) forwards NOTHING, which is the point.
//   `besideNext` needs no vocabulary here — it is one boolean, not a table, and the mutators
//   in report-draft.js are what write it. Its one refusal, `BESIDE_NO_NEXT` («the last view
//   has no next view to share a row with»), was forwarded for one client: a checkbox on every
//   view card that had to print the sentence when it was the last card. That control is gone
//   (the row seam is authored in the GAP between two cards, so it exists only where the
//   pairing is legal and has no refused state to explain), and the sentence stayed in the
//   grammar, where it guards hand-made JSON. A forward with no consumer is a wording nobody
//   reads and everybody has to keep true.
export const {
  HIGHLIGHT_OPS, HIGHLIGHT_COLORS, HIGHLIGHT_SCOPES, HIGHLIGHT_STROKE_WIDTHS, HIGHLIGHT_OWNER_TYPES,
  highlightStyleKeys, normHighlight, normHighlights,
  CM_FIELDS, CM_NO_SPEC_PERIOD, SWITCH_NO_SPEC_PERIOD, CM_NO_ENTITY_SCOPE, specWantsCm,
  // …and beside it `anyCmHighlight`, the same walk over a rule's four expression slots. Its
  // reader is the render path's `viewHoldsCm`: a view whose only CM360 expression is a
  // highlight must still publish its plan, and the answer has to be the grammar's own.
  anyCmHighlight,
  POINTER_SEP, RANGE_VALUES, PERIOD_CHOICES, WIDGET_PROFILES,
  CELL_FORMATS, FORMATS_BY_FAMILY, BASIS_FAMILY,
  ADDITIVE_FAMILIES, LIMITS, COLOR_SLOTS, VIEW_KINDS, ROW_SORT_KEY,
  UNIT_FAMILIES, FLOW_FIELDS, NODE_ID_RE, CONTROL_TYPES, isNodeId, formatLegal,
  PROJECTION_MODES, PROJECTION_BASES, PROJECTION_OUTPUTS, GUIDE_MODES,
  X_TYPES, ORIENTATIONS, CHART_FORMATS, DATE_DOMAINS, EMPTY_BEHAVIORS,
  GUIDE_LABEL_PLACEMENTS, AXES, ACCUMULATE_MODES,
  STYLE_TYPES, STROKE_WIDTHS, EXACT_STROKE_WIDTHS, DASH_PATTERNS, SEMANTIC_PAINTS,
  CURVES, AREA_FILLS, BAR_MODES, CALC_KINDS, CALC_BASES,
  LAYOUT_BRICK_TYPES, LAYOUT_FRAMES, LAYOUT_CANON_SERIES, LAYOUT_CANON_SOURCES,
  LAYOUT_CANON_NOTES, LAYOUT_DOMAIN_READINGS, LAYOUT_DELIVERY_UNITS, LAYOUT_RATE_UNITS, LAYOUT_HEADER_CONTENTS, LAYOUT_MONEY_ROLES, LAYOUT_KV_EMPHASIS,
  LAYOUT_STATROW_LAYOUTS, LAYOUT_PILL_VARIANTS, LAYOUT_BADGE_WORDS,
  LAYOUT_DELIVERY_ONLY, LAYOUT_GLOBAL_PERIOD_ONLY, LAYOUT_NO_PERIOD_CONTROL, LAYOUT_NO_SCOPE,
  ROW_TYPES, DELTA_ROW_TYPES, COLUMN_KINDS, SORT_DIRS,
  KPI_BASES, KPI_DENSITIES, TARGET_BANDS, COLUMN_ZERO_AS,
  walkViewNodes, flattenViews, leafViews, specByteLimit,
  normValue, normLabel, normControls, normLayoutView,
  derivedDatasetType, normReport, emptyReport,
} = ReportV2;

/**
 * Is this a canonical widget this bundle can author?
 *
 * Both discriminators are required: `kind === 'composite'` names the storage
 * envelope and `schemaVersion === 2` names the grammar this bundle understands.
 *
 * It reads no `spec`: a LINKED v2 instance carries only the discriminators plus
 * its `lib` ref, and it has to route to the v2 renderer just the same — the spec
 * arrives from the library entry, after resolution.
 *
 * `=== 2` is deliberate: future versions route to the explicit unavailable state.
 */
export function isV2Widget(w) {
  return w?.kind === 'composite' && w.schemaVersion === 2;
}

/**
 * A composite stored by a NEWER build than this one (spec §15 lockout, P2 Task 11).
 *
 * `isV2Widget` is exactly-2 on purpose. A tile from a newer grammar says one sentence
 * inside a normal frame rather than being handed to a renderer that cannot understand it.
 *
 * Numeric-checked because `schemaVersion` arrives out of config_json — a string "3" is
 * not a version this client may reason about.
 *
 * The validator REFUSES schemaVersion 3 on save (widgets-validate `v2Branch`), so
 * nothing this client writes can produce one. A row stored by a newer build, read
 * back by an older bundle, can.
 */
export function isFutureWidget(w) {
  return w?.kind === 'composite' && typeof w.schemaVersion === 'number' && w.schemaVersion > 2;
}

/**
 * What a surface says when a newer canonical grammar cannot be handled by this bundle.
 *
 * One vocabulary in one place, exactly like `ENTRY_GONE` in library-refs.js: each of
 * these sentences is said on two or three surfaces (the tile ⋯ and the gallery card
 * both refuse Edit; the card menu and both group-share paths both refuse Share), and
 * a second spelling is a user reading two sentences for one situation.
 *
 * They are REASONS, not errors: the affordance stays visible and disabled, and the
 * sentence rides its `title`.
 */
/** The forward-compat sentence (spec §15): the tile a newer build stored. */
export const FUTURE_VERSION = 'This widget needs a newer version of the app';

/**
 * The word on a canonical tile's frame badge (spec §15): `widget`, not `composite`.
 *
 * `composite` is a storage shape, not the product noun shown to a viewer.
 *
 * It is a CONSTANT rather than a literal on the tile because §15 flags the word for the
 * owner at acceptance: if it changes it changes here, in the module that already holds
 * every other piece of canonical vocabulary, and no surface re-types it.
 */
export const V2_BADGE = 'widget';

/**
 * May this library entry be added to a dashboard — and if not, why.
 *
 * Answers for all three entry kinds, because a canonical widget reaches a pacing through any
 * of them: a widget entry IS the definition; a block carries `members[]` and a layout
 * `widgets[]`, each member carrying an inline `definition` after cutover.
 *
 * Returns the sentence to show, or null when the entry may be added.
 */
export function libraryAddBlocked(entry) {
  const def = entry?.definition;
  if (!def) return null;
  const kind = entry.kind === 'block' || entry.kind === 'layout' ? entry.kind : 'widget';
  const defs = kind === 'widget'
    ? [def]
    : ((kind === 'block' ? def.members : def.widgets) || []).map((m) => m?.definition);
  return defs.some(isFutureWidget) ? FUTURE_VERSION : null;
}

/**
 * The GRAMMAR epoch, mirrored from dash-gate (db.mjs `WIDGET_UNIFICATION_EPOCH`).
 *
 * `contextWidgetSpec` says which widget SHAPE the two sides store; this says which revision of
 * the closed grammar inside it they speak. 1 was the unification cutover (2026-08-25);
 * 2 added widget value sources (2026-08-26); 3 added recursive containers and atoms
 * (2026-09-05); 4 added named domain readings and authored brick options (2026-09-06);
 * 5 is the sections cutover (2026-09-07), which shrank the enabled{} id domain to the four
 * functional blocks; 6 adds Highlight children (2026-09-09); 7 adds calculated child Guides
 * (2026-09-10). Older readers cannot preserve these
 * closed-grammar fields when editing, and an older writer still speaks the four section ids
 * the server no longer stores.
 *
 * The match is EXACT in both directions (hasV2Capability below): a server a phase behind cannot
 * store what this bundle writes, and one a phase ahead speaks something this bundle has not been
 * told about. `tests/dashboard/report-widget.test.js` reads both residences out of their source
 * text, so a bump on one side alone goes red there.
 */
export const WIDGET_UNIFICATION_EPOCH = 7;
export const WIDGET_PROTOCOL = Object.freeze({
  contextWidgetSpec: 2,
  contextWidgetUnification: WIDGET_UNIFICATION_EPOCH,
});

/**
 * Has the server told us it can store v2 (spec §7.5 handshake, the client half)?
 *
 * Takes the `capabilities` object a response carried — `store.capabilities`, adopted from the
 * dashboard read path and refreshed by every settings 200 — and answers the one question the
 * write path asks: may this bundle attach the `{contextWidgetSpec: 2}` writer marker. null /
 * undefined is a NO, which is what an older server, and a screen that has not loaded yet,
 * both read as.
 *
 * It lives HERE, beside isV2Widget, and not in the store: `2` is the version this client
 * speaks, and the store is not where a version literal may take up a second residence.
 *
 * `=== 2` for the same reason isV2Widget above uses it: a server advertising a version this
 * bundle does not know is not a server this bundle may write v2 to.
 */
export function hasV2Capability(capabilities) {
  return capabilities?.contextWidgetSpec === WIDGET_PROTOCOL.contextWidgetSpec
    && capabilities?.contextWidgetUnification === WIDGET_PROTOCOL.contextWidgetUnification;
}

/**
 * The writer marker on a settings save (spec §7.5/§7.6, the client half) — the mirror of
 * dash-gate's `isV2Writer`/`V2_CAPABILITIES` (db.mjs).
 *
 * A save that CHANGES a v2 widget is refused (`v2_writer_required`) unless the bundle
 * declares it speaks the version. So every widgets-carrying send site pipes its config
 * through here, and this is the only place in the client that spells the marker out.
 *
 * Not capable ⇒ the SAME object back, not a copy: an older server must receive byte for
 * byte the save it has always received, and a marker it would 400 must never be attached
 * on a guess. Capable ⇒ a fresh object; the caller's config is never mutated, because
 * applyAutoAdd hands over one it also reads.
 *
 * `display_writer` (not `writer`) because it rides the `config` envelope beside `display`
 * and `display_rev` — the server's own reason for the two spellings. It is TRANSPORT:
 * dash-gate never stores it.
 */
export function withWriter(config, capabilities) {
  if (!hasV2Capability(capabilities)) return config;
  return { ...config, display_writer: { ...WIDGET_PROTOCOL } };
}

/** Attach the matching transport marker to a Library mutation. */
export function withLibraryWriter(body, capabilities) {
  if (!hasV2Capability(capabilities)) return body;
  return { ...body, writer: { ...WIDGET_PROTOCOL } };
}
