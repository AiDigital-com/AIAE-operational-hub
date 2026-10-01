import { flattenViews } from '../report-v2.js';
import { boundElements, dimensionGrains } from '../report-draft.js';
import { calculatedGuideLabel } from '../report-render.js';
import { columnName, seriesName, valueName, viewName } from './view-text.js';

const arr = (value) => (Array.isArray(value) ? value : []);

export function metricControlSummary(control, spec) {
  const options = arr(control?.options);
  if (!options.length) return 'No options';
  const count = `${options.length} ${options.length === 1 ? 'option' : 'options'}`;
  if (control.defaultBy === 'buyUnit') return `${count} · Match buy type`;
  const start = options.find((option) => option.id === control.defaultOptionId);
  return start ? `${count} · Starts with ${columnName(start, spec)}` : count;
}

/** Authored users of one widget control, in content order. IDs point at the same
 * nodes the editor selects; the names follow the content rows, including custom labels. */
export function controlConnections(spec, controlId) {
  const controls = arr(spec?.controls);
  const control = controls.find((item) => item?.id === controlId);
  if (!control) return [];
  // Period changes the widget's window. Full-flight readings retain their own
  // meaning, so do not promise that each individual element changes its value.
  if (control.type === 'period') return [{
    key: `${control.id}:widget`, kind: 'period', viewId: null,
    label: 'Entire widget', viewLabel: 'Entire widget',
  }];

  const views = flattenViews(spec?.views);
  const byId = new Map(views.map((view) => [view.id, view]));
  const out = [];
  const add = (entry) => {
    const view = byId.get(entry.viewId);
    if (!view) return;
    out.push({
      ...entry,
      key: `${control.id}:${view.id}:${entry.kind}:${entry.elementId || ''}`,
      viewLabel: viewName(view, spec),
    });
  };

  // Bound values name the single metric control by type, not by an invented ID.
  // Reuse the reader beside removeControl so the visible users and removal agree.
  if (control.type === 'metric' && controls.find((item) => item?.type === 'metric') === control) {
    for (const entry of boundElements(spec)) {
      const view = byId.get(entry.viewId);
      const series = arr(view?.series).find((item) => item.id === entry.elementId);
      const column = arr(view?.columns).find((item) => item.id === entry.elementId);
      const label = entry.kind === 'series' ? seriesName(series, spec)
        : entry.kind === 'guide' ? `Guide on ${seriesName(series, spec)}`
          : entry.kind === 'column' ? columnName(column, spec)
            : entry.kind === 'share' ? 'Row share'
              : entry.kind === 'target' ? 'Target'
                : valueName(view?.value, spec);
      add({ ...entry, label });
    }
  }

  if (control.type === 'dimension') {
    for (const entry of dimensionGrains(spec)) {
      const view = byId.get(entry.viewId);
      if (view?.[entry.kind]?.controlId !== control.id) continue;
      add({ ...entry, label: { x: 'X axis', rows: 'Rows', sliceBy: 'Slices' }[entry.kind] });
    }
  }

  for (const view of views) {
    if (view.kind === 'compare' && (
      (control.type === 'metric' && view.metricControlId === control.id)
      || (control.type === 'breakdown' && view.breakdownControlId === control.id)
    )) add({ viewId: view.id, kind: 'compare', label: 'Comparison' });
    if (control.type !== 'projection' || view.kind !== 'chart') continue;
    for (const series of arr(view.series)) {
      if (series?.kind === 'calc' && series.calc === 'projection' && series.modeControlId === control.id) {
        add({ viewId: view.id, elementId: series.id, kind: 'projection', label: seriesName(series, spec) });
      }
      if (series?.guide?.calc === 'projection' && series.guide.modeControlId === control.id) {
        add({ viewId: view.id, elementId: series.id, kind: 'guide',
          label: `${series.guide.label || calculatedGuideLabel(series.guide, series.accumulate)} on ${seriesName(series, spec)}` });
      }
    }
  }

  // Bound slots and Compare references are discovered separately, but the list
  // follows the widget's tree rather than grouping unrelated owners by slot type.
  const position = new Map(views.map((view, index) => [view.id, index]));
  return out.sort((a, b) => position.get(a.viewId) - position.get(b.viewId));
}
