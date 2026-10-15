// Editor-local Widget drafts. These constructors deliberately produce the small set of
// incomplete shapes the Builder knows how to finish; strict validation still owns the
// display/Library/server boundary.
import { emptyReport } from '../report-v2.js';
import {
  addView, datasetTypeOf, setControl, setDataset,
} from '../report-draft.js';

const viewless = (id, title, profile) => {
  const base = emptyReport(profile);
  return {
    id,
    title,
    ...base,
    profile,
    spec: { ...base.spec, views: [] },
  };
};

const onlyView = (widget, kind, opts) => {
  const spec = addView(widget.spec, kind, opts);
  return { ...widget, spec };
};

/**
 * mintWidgetDraft({ id, start }) -> a fresh canonical-v2 editor draft.
 *
 * `start` is authoring state only. It is never written into the Widget. Scratch starts are
 * intentionally incomplete and therefore must remain inside the Builder until strict
 * validation succeeds.
 */
export function mintWidgetDraft({ id, start }) {
  if (start === 'blank') return viewless(id, 'New widget', 'section');

  if (start === 'chart') {
    const widget = onlyView(viewless(id, 'New chart', 'chart'), 'chart');
    const view = widget.spec.views[0];
    return { ...widget, spec: { ...widget.spec, views: [{ ...view, series: [] }] } };
  }

  if (start === 'table') {
    const widget = onlyView(viewless(id, 'New table', 'table'), 'table');
    const view = widget.spec.views[0];
    return { ...widget, spec: { ...widget.spec, views: [{ ...view, columns: [] }] } };
  }

  if (start === 'kpi') {
    const widget = onlyView(viewless(id, 'New KPI', 'card'), 'kpi');
    const view = widget.spec.views[0];
    return { ...widget, spec: { ...widget.spec, views: [{ ...view, value: null }] } };
  }

  if (start === 'pie') {
    // addView needs a real string so it can reserve the complete key set. The draft then
    // clears the authored choices; neither a dimension nor a metric is guessed for the user.
    const widget = onlyView(viewless(id, 'New pie', 'card'), 'pie', { sliceByKey: 'channel' });
    const view = widget.spec.views[0];
    return {
      ...widget,
      spec: { ...widget.spec, views: [{ ...view, value: null, sliceBy: null }] },
    };
  }

  if (start === 'compare') {
    let widget = viewless(id, 'New comparison', 'section');
    let spec = setDataset(widget.spec, {
      type: 'deliveryCm360', mapping: { mode: 'runtime' },
    });
    spec = addView(spec, 'compare');
    spec = setControl(spec, {
      type: 'metric', options: [], defaultOptionId: null,
    });
    spec = setControl(spec, { type: 'breakdown', maxSelected: 20 });
    widget = { ...widget, datasetType: datasetTypeOf(spec), spec };
    return widget;
  }

  throw new TypeError(`mintWidgetDraft: unknown start "${String(start).slice(0, 24)}"`);
}
