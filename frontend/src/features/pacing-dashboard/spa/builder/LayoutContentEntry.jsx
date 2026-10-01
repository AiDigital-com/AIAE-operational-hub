import { useEffect, useId, useMemo, useRef } from 'react';
import Popover from '../Popover.jsx';
import {
  PopupCoordinatorContext, usePopupCoordinator, usePopups,
} from '../PopupCoordinator.jsx';
import ContentRow from './ContentRow.jsx';

/** A value picker opened inside settings belongs to that settings panel.
 * Its local coordinator replaces sibling pickers, while its portal is also visible
 * to the drawer's focus trap. Closing the outer panel closes its picker too. */
export function NestedEntryPopups({ active, children }) {
  const parent = usePopups();
  const nested = usePopupCoordinator();
  const registerParent = parent?.registerPortal;
  const registerLocal = nested.registerPortal;
  const registerPortal = useMemo(() => (id, element) => {
    const dropLocal = registerLocal(id, element);
    const dropParent = registerParent?.(id, element);
    return () => { dropLocal(); dropParent?.(); };
  }, [registerLocal, registerParent]);
  const closeAll = nested.closeAll;
  useEffect(() => { if (!active) closeAll(); }, [active, closeAll]);
  useEffect(() => () => closeAll(), [closeAll]);
  const context = useMemo(() => ({ ...nested, registerPortal }), [nested, registerPortal]);
  return <PopupCoordinatorContext.Provider value={context}>{children}</PopupCoordinatorContext.Provider>;
}

export default function LayoutContentEntry({
  label, summary, marker, error, open, onOpen, onClose, onRemove, removeLabel, children,
  nested = false, roleLabel, settingsTitle, buttonRef,
}) {
  const localAnchorRef = useRef(null);
  const anchorRef = buttonRef || localAnchorRef;
  const id = useId();
  const errorId = `layout-entry-error-${id}`;
  return (
    <div className={`sp-content-item${nested ? ' sp-content-item--child' : ''}`}>
      <ContentRow buttonRef={anchorRef} label={label} summary={summary} marker={marker}
        open={open} onOpen={onOpen} roleLabel={roleLabel}
        buttonProps={{ 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined }}
        actions={onRemove ? <button type="button" className="sp-rb-btn sp-rb-btn--rm" aria-label={removeLabel} onClick={onRemove}>×</button> : null} />
      {error ? <div id={errorId} className="sp-lay-refusal" role="status">{error}</div> : null}
      <Popover anchorRef={anchorRef} title={settingsTitle || roleLabel || label} open={open} onClose={onClose} width={400} keepMounted>
        <NestedEntryPopups active={open}>
          <div className="sp-content-settings">{children}</div>
        </NestedEntryPopups>
      </Popover>
    </div>
  );
}
