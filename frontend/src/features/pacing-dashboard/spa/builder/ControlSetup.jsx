import { useRef, useState } from 'react';
import { LIMITS } from '../report-v2.js';
import { setControl } from '../report-draft.js';
import {
  BreakdownPopover, DimensionSwitchPopover, MetricSwitchPopover,
  PeriodSwitchPopover, ProjectionPopover,
} from './ControlPopovers.jsx';

const PANELS = { metric: MetricSwitchPopover, period: PeriodSwitchPopover,
  dimension: DimensionSwitchPopover, breakdown: BreakdownPopover, projection: ProjectionPopover };

// This is form readiness, not report validity: a newly configured switch may
// still need a consumer. The existing report validator owns that Save gate.
export function controlSetupReady(control) {
  if (!control.label?.trim()) return false;
  if (control.type === 'metric') return control.options?.length >= 2
    && control.options.some((option) => option.id === control.defaultOptionId);
  if (control.type === 'period' || (control.type === 'dimension' && !control.optionsAuto)) {
    return control.options?.length >= 2 && control.options.includes(control.defaultOption);
  }
  if (control.type === 'breakdown') return Number.isInteger(control.maxSelected)
    && control.maxSelected >= 1 && control.maxSelected <= LIMITS.breakdownMaxSelected;
  return true;
}

export default function ControlSetup({ widget, setup, env, anchorRef, onCreate, onClose }) {
  const [draft, setDraft] = useState(setup.spec);
  const firstRef = useRef(null);
  const control = draft.controls.find((item) => item.type === setup.type);
  const Panel = PANELS[setup.type];
  return <Panel widget={{ ...widget, spec: draft }} control={control}
    anchorRef={anchorRef} firstRef={firstRef} patch={setDraft} hideRefusal
    dims={env.dims} autoOptions={env.autoDims}
    onAskAuto={() => setDraft((spec) => setControl(spec, { type: 'dimension', optionsAuto: true }))}
    onClose={onClose}
    footer={<div className="sp-control-setup-actions">
      <button type="button" className="sp-rb-btn" onClick={onClose}>Cancel</button>
      <button type="button" className="sp-rb-btn sp-control-create"
        disabled={!controlSetupReady(control)} onClick={() => onCreate(control)}>Create control</button>
    </div>} />;
}
