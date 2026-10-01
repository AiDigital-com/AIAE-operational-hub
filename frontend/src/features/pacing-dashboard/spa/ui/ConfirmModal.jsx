// workspace/src/components/ui/ConfirmModal.jsx
//
// The question this product asks before it takes something away. Used from the Overview, the
// Team screen, the Settings drawer and the v2 builder — one shape, so a question that deletes
// always looks and behaves like a question that deletes.
//
// It is a real DIALOG, and it says so (§10.3): `role="dialog"` + `aria-modal` + a name taken
// from its own title, focus that MOVES INTO it and comes back to whatever opened it, and a
// Tab cycle that stays inside. Before this it was a plain `<div>` over an overlay: a screen
// reader was told nothing, Tab walked the page behind it, and focus stayed wherever the
// button that opened it had left it — so a keyboard reader could press Enter on something
// underneath a question they had not read.
//
// THE TRAP DEFERS INNER-FIRST, the same rule Escape keeps. This modal marks itself
// `data-dp-modal="1"`, and `useFocusTrap` stands back for a marked modal that is not its own
// — otherwise the Settings drawer's trap, which registers first and calls `preventDefault`,
// would cycle the whole drawer while a question sits on top of it.
import { useId, useRef, useEffect } from 'react';
import { useFocusTrap, useFocusOnOpen, useOpenerRestore } from './PopupCoordinator.jsx';

// `cancelLabel` defaults to "Cancel" — the word every caller before it relied on. It is a
// prop because one question is not «do it / never mind»: removing the CM360 source offers
// «Remove them» against «Keep source», and both buttons name what they DO to the draft. A
// dialog whose second button says Cancel there would leave the reader guessing which of the
// two outcomes it is.
//
// `onDismiss` is the THIRD answer, and it is optional (P3 T18). Escape and the scrim mean
// «not now», which on a «do it / never mind» question is Cancel and rightly so. It is not
// Cancel on a question whose BOTH buttons act — the Save-time skipped-elements prompt, where
// Keep and Remove each store the draft — so a caller that has somewhere else for «not now»
// to go names it here, and Escape and the scrim (this dialog has no ✕; if it ever grows one,
// that is the third gesture) take it instead of answering. Absent, both are the Cancel they
// have always been, to the byte.
//
// `primaryAction` says WHICH answer is the filled one and takes focus: 'confirm' (the
// default, and every caller before T18) or 'cancel'. It exists because the destructive
// answer is not always the likely one: on that same prompt «Keep» is the safe, common reply
// and «Remove» deletes report content, and a dialog that fills the destructive button and
// puts focus on it is asking to be answered by a reflex.
export default function ConfirmModal({
  title, message, confirmLabel, cancelLabel = 'Cancel', confirmColor, primaryAction = 'confirm',
  onConfirm, onCancel, onDismiss, loading, disabled, children,
  // A question that ASKS for text (the group rename) wants its field focused, not its
  // button: the primary lands on the next frame, after the input's own autoFocus, so a
  // reflex Enter used to commit before a letter was typed. Optional; absent = the primary.
  initialFocusRef = null,
}) {
  // An open confirm OWNS Escape (round 8). Capture phase: keydown targets the
  // focused element deep in the DOM, so window-capture fires before any
  // window-bubble listener (e.g. the Settings drawer's Esc-to-close) —
  // stopPropagation here is what prevents a second confirm from stacking on
  // top of this one (the Back → Esc case).
  const dismissRef = useRef(null);
  dismissRef.current = onDismiss || onCancel;
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      dismissRef.current?.();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const uid = useId();
  const boxRef = useRef(null);
  const primaryRef = useRef(null);
  // It is only ever rendered WHILE open — every caller mounts it on a condition — so `open`
  // is simply true. The opener is captured and restored around that mount.
  useOpenerRestore(true);
  // The PRIMARY, not the first stop: this dialog exists to be answered, and its answer is
  // the button the caller named. The other is one Shift+Tab away and Escape is always there.
  useFocusOnOpen(boxRef, true, initialFocusRef || primaryRef);
  useFocusTrap(boxRef, { active: true });

  const cancelIsPrimary = primaryAction === 'cancel';
  // The app's own primary language (`.sp-btn-p`: accent + its contrast), and the danger
  // treatment it already uses where a destructive action is NOT the primary: its own colour
  // on the surface, the way `.sp-tp-link-danger` and `.wgm-item--danger` wear it. No new
  // colour, and no border or fill on either — two buttons on one row stand at one height.
  //
  // Colour ALONE, deliberately, and not the red TINT those two rules take for their second
  // «are you sure» click: measured, `--status-red` on `--status-red-dim` is 3.60:1 in light,
  // where the same red on the surface is 4.32:1 — the ratio the filled destructive button
  // has always had. A destructive answer must not be the one word on the dialog that is
  // hardest to read.
  const cancelButton = (
    <button
      key="cancel"
      type="button"
      ref={cancelIsPrimary ? primaryRef : null}
      onClick={onCancel}
      className="px-4 py-2 rounded-10 text-sm font-medium transition-colors"
      style={cancelIsPrimary
        ? { background: 'var(--accent)', color: 'var(--accent-contrast)' }
        : { color: 'var(--text-secondary)' }}
    >
      {cancelLabel}
    </button>
  );
  const confirmButton = (
    <button
      key="confirm"
      type="button"
      ref={cancelIsPrimary ? null : primaryRef}
      onClick={onConfirm}
      disabled={disabled || loading}
      className={cancelIsPrimary
        ? 'px-4 py-2 rounded-10 text-sm font-medium disabled:opacity-40 transition-colors'
        : 'px-4 py-2 rounded-10 text-sm font-medium text-white disabled:opacity-40 transition-colors'}
      style={cancelIsPrimary
        ? { color: 'var(--status-red)' }
        : {
          background: confirmColor || 'var(--status-red)',
          ...(confirmColor === 'var(--accent)' ? { color: 'var(--accent-contrast)' } : null),
        }}
    >
      {loading ? 'Working...' : confirmLabel}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0" style={{ background: 'var(--overlay)' }} onClick={onDismiss || onCancel} />
      <div
        ref={boxRef}
        data-dp-modal="1"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-t`}
        aria-describedby={`${uid}-m`}
        className="relative p-6 w-full max-w-md mx-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow-card)' }}
      >
        <h3 id={`${uid}-t`} className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        <p id={`${uid}-m`} className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>{message}</p>
        {children}
        {/* Left to right, the primary is LAST — the rhythm of the drawer's own footer
            (Reset, then Save). The reading ends on the answer the caller called primary,
            and where that is Keep the destructive one no longer sits where the pointer
            lands out of habit. */}
        <div className="flex gap-3 justify-end mt-4">
          {cancelIsPrimary ? [confirmButton, cancelButton] : [cancelButton, confirmButton]}
        </div>
      </div>
    </div>
  );
}
