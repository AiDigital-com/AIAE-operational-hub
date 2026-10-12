// The top-N table a high-cardinality sheet column needs, in the shape the SERVER accepts.
//
// WHY THIS EXISTS, rather than `topNWidgetFor` from `spa/sheet-source-norm.js`. That moved function
// returns the pre-v2 table shape - `{kind:'table', rows:{dim}, columns:[{source:{field}}], sort:
// {col}}` - and dash-gate has refused that shape since the canonical-widget cutover:
//
//   widget w_gndylvq7: canonical widget kind must be "composite", got "table"
//     (dash-gate/lib/widgets-validate.mjs:235)
//
// So the mapping screen's "Create a table of the top 20" minted a widget that could be added to the
// draft, drawn in the list, and then failed the Save - with an error naming an id the person never
// chose, on a tab they were not on. Verified on the reference branch (`origin/ogan-team`): its
// `topNWidgetFor` returns the same pre-v2 shape and its `widgets-validate.mjs` carries the same
// refusal, line for line. The button is broken there too; this is a deliberate divergence, asked
// for by the owner ("надо фиксить", 2026-10-12), not a port.
//
// The canonical shape is taken from the Standard catalog's own tables (`spa/std-entries.js`:
// `sectionDefinition` + the Breakdown entry's `rows` view), so a widget minted here is the same
// kind of object the gallery's own templates produce.

import { metricSlotsFor } from "../spa/sheet-source-norm.js";

/** The unit family a column's format implies - what `metricValue` is built with in the catalog. */
function familyOf(format) {
  return format === "money" ? "money" : "count";
}

/**
 * A canonical table widget showing the top N values of one sheet column.
 *
 * The SORT is the load-bearing part, for the reason the moved function gives: the table slices its
 * limit AFTER sorting, so a limit with no sort shows the first N rows BY NAME and calls itself a
 * top N. The ranking column is impressions when the source carries them, because that is the unit
 * every other figure on these screens is measured in.
 *
 * @param {object} source the stored dim source
 * @param {{key: string, label?: string}} dim the column entry being turned into a table
 * @param {number} n how many rows
 */
export function topNCompositeFor(source, dim, n = 20) {
  const metrics = ((source.origin || {}).columns || {}).metrics || {};
  const ranking = metrics.im ? "im" : Object.keys(metrics)[0];
  const slots = metricSlotsFor(source);
  const order = slots.map((s) => s.key).filter((k) => metrics[k]);
  const ranked = [ranking, ...order.filter((k) => k !== ranking)].filter(Boolean);

  const columns = ranked.map((k) => {
    const slot = slots.find((s) => s.key === k) || {};
    const format = slot.format || "int";
    return {
      // Keyed by the METRIC, not `c1`/`c2`: the sort below names a column id, and a positional id
      // means the sort silently follows whichever metric happens to land first.
      id: k,
      kind: "value",
      label: slot.label || k,
      labelAuto: false,
      value: { kind: "metric", metric: k, source: "bq", unitFamily: familyOf(format) },
      format,
    };
  });

  return {
    kind: "composite",
    title: dim.label || dim.key,
    profile: "table",
    schemaVersion: 2,
    datasetType: "delivery",
    spec: {
      dataset: { type: "delivery" },
      // Follows the dashboard's own range, the way every catalog section does.
      period: null,
      controls: [],
      views: [{
        id: "rows",
        kind: "table",
        title: "",
        rows: { type: "dim", key: `ds:${source.id}:${dim.key}` },
        columns,
        sort: { columnId: columns.length ? columns[0].id : "__row__", dir: "desc" },
        totals: true,
        limit: n,
        search: true,
      }],
      interactions: [],
      formatDefaultsVersion: 1,
    },
  };
}
