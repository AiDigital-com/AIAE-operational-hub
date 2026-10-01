import { useRef, useState } from 'react';
import Popover from '../Popover.jsx';
import { DIM_LABELS } from '../metric-catalog.js';
import { dimLabel, valueName } from './view-text.js';
import { useControlNavigation } from './ControlNavigation.jsx';
import { MetricSwitchPopover, DimensionSwitchPopover } from './ControlPopovers.jsx';
import { addSwitchMetric, beginSwitch, commitSwitch, switchCandidate, switchSlotInfo, switchActionReason, switchOptionReason } from './contextual-switch.js';

const arr = (v) => (Array.isArray(v) ? v : []);

/** Mounted by the CARD, outside the settings popover it replaces. Cancel writes nothing. */
export function ContextualSwitchDialog({ widget, slot, env = {}, anchorRef, patch, onClose }) {
  const [session] = useState(() => beginSwitch(widget, slot, env));
  const [draft, setDraft] = useState(() => session?.draft);
  const [error, setError] = useState(null);
  const firstRef = useRef(null);
  const navigation = useControlNavigation();
  if (!session) return null;
  const local = { ...session, draft };
  const candidate = switchCandidate(widget, local);
  const connected = session.info.connected;
  const control = draft.controls.find((c) => c.type === session.info.type);
  const finish = () => {
    anchorRef?.current?.focus?.({ preventScroll: true });
    onClose();
  };
  const apply = () => {
    const check = commitSwitch(widget, local);
    if (!check.ok) { setError(check.reason); return; }
    patch((spec) => commitSwitch({ ...widget, spec }, local).spec);
    finish();
  };
  const footer = <>
    {!session.existing && session.info.type === 'metric' ? <p className="sp-pop-note">New catalog options read {session.info.value.source === 'cm' ? 'CM360' : 'BQ'}. Pick the starting option above.</p> : null}
    {error || candidate.reason ? <p className="sp-pop-bad" role="status">{error || candidate.reason}</p> : null}
    <div className="sp-rb-row">
      <button type="button" className="sp-rb-btn" onClick={finish}>{connected ? 'Close' : 'Cancel'}</button>
      {!connected ? <button type="button" className="sp-rb-btn" disabled={!candidate.ok} onClick={apply}>
        {session.existing ? 'Connect this slot' : 'Create and connect'}
      </button> : null}
    </div>
  </>;
  // An AUTO dimension switch (sections cutover 2026-09-07) stores no options: what it offers
  // is the list the builder's store seam already resolved for the open pacing, and reading
  // `control.options` here would be a `map` on nothing.
  const auto = control.optionsAuto === true;
  const autoOptions = arr(env.autoDims);
  const canEditShared = typeof navigation?.openControl === 'function'
    && arr(widget.spec?.controls).some((item) => item?.id === control.id);
  if (session.existing) return <Popover open anchorRef={anchorRef} onClose={onClose} title={connected ? control.label : `Connect ${control.label}`}>
    <p className="sp-pop-note">{connected ? `This ${session.info.type === 'metric' ? 'value' : 'dimension'} follows the shared options.` : 'Only this slot will be connected. Existing options and other connections stay as authored.'}</p>
    {auto ? <p className="sp-pop-note">Auto: every dimension this pacing has.</p> : null}
    <ul aria-label="Existing switch options">{arr(auto ? autoOptions : control.options).map((o) => <li key={typeof o === 'string' ? o : o.id}>
      {typeof o === 'string' ? (dimLabel(env.dims, o) || DIM_LABELS[o] || o) : (o.labelAuto === false && o.label ? o.label : valueName(o.value, draft))}
      {(typeof o === 'string' ? (!auto && o === control.defaultOption) : o.id === control.defaultOptionId) ? ' · starts here' : ''}
    </li>)}</ul>
    {canEditShared ? <button type="button" className="sp-pop-set" onClick={() => {
      const anchor = anchorRef?.current || null;
      onClose();
      navigation.openControl(control.id, anchor);
    }}>Edit shared control</button> : null}
    {footer}
  </Popover>;
  const common = { widget:{...widget,spec:draft}, control, anchorRef, firstRef, patch:setDraft, onClose, footer, hideRefusal:true,
    candidateReason:(next) => switchOptionReason(widget, local, next) };
  return session.info.type === 'metric'
    ? <MetricSwitchPopover {...common} buildOption={(spec, _control, entry) => addSwitchMetric(spec, session, entry)} />
    : <DimensionSwitchPopover {...common} dims={env.dims || []} autoOptions={autoOptions} />;
}

export function SwitchAction({ widget, slot, env, onClick }) {
  const info = switchSlotInfo(widget.spec, slot);
  if (!info) return null;
  const reason = switchActionReason(widget, slot, env);
  return <span className="sp-switch-action">
    <button type="button" className="sp-pop-set" disabled={!!reason} onClick={() => { if (!reason) onClick(); }}>
    {info.connected ? 'Connected switch…' : `Make ${info.type === 'metric' ? 'value' : 'dimension'} switchable…`}
    </button>
    {reason ? <span className="sp-pop-note">{reason}</span> : null}
  </span>;
}

/** The slot and its stable card anchor survive the source settings panel unmount. */
export function useContextualSwitch(widget, env, patch) {
  const [opened, setOpened] = useState(null);
  return {
    open:(slot, anchorRef) => setOpened({slot,anchorRef:{current:anchorRef?.current || null}}),
    dialog:opened ? <ContextualSwitchDialog key={`${opened.slot.viewId}:${opened.slot.kind}:${opened.slot.elementId || ''}`} widget={widget} env={env} patch={patch}
      slot={opened.slot} anchorRef={opened.anchorRef} onClose={() => setOpened(null)} /> : null,
  };
}
