// workspace/src/pages/Dashboard/components/Settings/Widgets/BlockLibrary.jsx
//
// The per-pacing management list (widget-library spec 2026-08-14 §6.1).
// Compact page-section rows and widget rows share the same switch and ONE
// write path with it: every card here rides display.enabled, a VIEW PREFERENCE that
// saves the instant it is flipped, alone, through the per-entry merge lane, so two
// people switching different tiles never fight and the drawer's Save never carries
// the map (spec §4).
//
// The hero pills, the Finance toggle and the twelve chart checkboxes are GONE. They
// were the half of this gallery that wrote drawer-draft keys (display.hero /
// display.sections / display.charts[]), and those keys are retired: the hero, Finance
// and every chart are ordinary widget instances now, so they appear as tile cards in
// WidgetGallery below and are ADDED from the Library's Standard shelf.
import { useEffect, useRef, useState } from 'react';
import { hasSwitch, FUNCTIONAL_BLOCK_IDS }
  from '../display-blocks.js';
import { useDashboardStore } from '../store.js';
import { selectHasConversions } from '../selectors.js';
import Switch from './Switch.jsx';
import LineItemsCustomize from '../lineitems/LineItemsCustomize.jsx';
import { useEnabledSwitch } from './useEnabledSwitch.js';
import WidgetGallery from './WidgetGallery.jsx';
import LibraryScreen from './LibraryScreen.jsx';
// HistoryScreen is NOT moved: the arrangement history is not part of this app (owner decision
// 2026-10-14). Its door below goes with it; see ../SOURCE.md.

// Card titles for the 4 code-rendered blocks. Keyed by the shared id list so a
// new functional block cannot be added without a card (the parity pin in
// tests/dashboard/dash-blocks.test.js catches the registry half). Targets, 3rd Party
// Data, Breakdown and Daily Performance are not here since the sections cutover: each
// is a widget instance, and its card is the tile card in the gallery below.
const BLOCK_META = {
  launchPlan: ['Launch Plan', 'Pre-flight recommendations, until delivery starts.'],
  alerts: ['Alerts', 'Pacing, margin and delivery warnings.'],
  lineItems: ['Line Items', 'Per-line delivery, pacing and margin cards.'],
  journal: ['Journal', 'Notes and changes recorded against this pacing.'],
};

// The chart cards and their "comes back on reload" warning both retired here in
// phase 3: a chart is a widget instance, added from the Library's Standard shelf and
// switched by its own tile card, and the rate-type rules that used to resurrect a
// deleted one now run ONCE and remember what they added (display.autoAdded, §1a.1).

// The off treatment is a class on the card root, stated ONCE so every card wears
// the same convention.
const cardClass = (on) => `blib-card${on ? '' : ' blib-card--off'}`;

/**
 * The card every gallery entry is: full-bleed sketch, a name row whose right end
 * holds the control, a description, and optional card-level options below it.
 * `control` is an element rather than a boolean so the same card serves a switch,
 * nothing at all, and whatever phase 2 hangs there (badges, a menu).
 */
function GalleryCard({ name, desc, on, control, wide = false, cardRef = null, children }) {
  return (
    <div className={`${cardClass(on)}${wide ? ' blib-card--wide' : ''}`} ref={cardRef}>
      <div className="blib-card-b">
        <div className="blib-card-row">
          <span className="blib-card-name">{name}</span>
          {control}
        </div>
        {desc && <span className="blib-card-desc">{desc}</span>}
        {children}
      </div>
    </div>
  );
}

export default function BlockLibrary({
  display, onChange, onEditingChange, onDraftInvalidChange, onWidgetDraftInvalidChange,
  showDescription, onShowDescriptionToggle, openWidgetId, openLibrary, onLibraryOpened,
  draftCm360Configured, savedEpoch, savedDisplay, submittedDisplayRef, onOpened, resetEpoch, casEnabled, casReason, onCasSaved,
  // The Line Items card's settings (spec 2026-10-01): the draft key, its writer, and the
  // deep-open request from the tile's ⋯ → Customize… ({ id, nonce } | null, cleared by onBlockOpened).
  lineItems, onLineItemsChange, openBlockId = null, onBlockOpened, editorRequest = null,
}) {
  const [editing, setEditing] = useState(false);
  const handleEditing = (v) => { setEditing(v); onEditingChange?.(v); };
  // The Line Items card's Customize disclosure. Opening it writes nothing: the draft changes
  // only when a value does. The deep-open request waits until the gallery is in view (an
  // open editor is asked to close by the drawer's editorRequest; a cancelled discard keeps
  // it open and this stays pending), then expands the card and scrolls it into view.
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [pendingBlock, setPendingBlock] = useState(null);
  const lineItemsCardRef = useRef(null);
  const hasConversions = useDashboardStore(selectHasConversions);
  useEffect(() => {
    if (!openBlockId?.nonce) return;
    setPendingBlock(openBlockId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openBlockId]);
  // 'gallery' | 'library' | 'history' — the Display tab's screens (spec §6.2, and
  // display-history spec 2026-09-03). One flag, and nothing else about this component
  // changes with it: a second screen renders BESIDE the gallery, never instead of it
  // (see the return below).
  const [screen, setScreen] = useState('gallery');

  // Deep-open (Task 10): Layout mode's "+ Add" and the empty sheet's "Open
  // Library". The nonce is what makes a second press work while the drawer is
  // already open; clearing the request through onLibraryOpened is what stops the
  // screen re-opening for ever after Back.
  useEffect(() => {
    if (!openLibrary?.nonce) return;
    setScreen('library');
    onLibraryOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLibrary]);

  // The widget editor takes over the whole tab; the Library cannot be underneath
  // it. Leaving the editor does NOT bring the Library back — the person who
  // pressed Back on an editor is looking at the gallery.
  useEffect(() => { if (editing) setScreen('gallery'); }, [editing]);
  useEffect(() => {
    if (!pendingBlock) return;
    if (editing) return;                                   // the editor is being asked to close first
    if (screen !== 'gallery') { setScreen('gallery'); return; }
    if (pendingBlock.id === 'lineItems') {
      setCustomizeOpen(true);
      const el = lineItemsCardRef.current;
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
    setPendingBlock(null);
    onBlockOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBlock, editing, screen]);

  // enabled{} is LIVE store state, never drawer draft (spec §4) — the hook reads it
  // from the store so a switch flipped here, or by anyone else, is what the card
  // shows. Same hook, same lane, as the custom-widget cards below.
  const { isOn, setOn, isBusy } = useEnabledSwitch(onChange);

  // ONE return, stable root, WidgetGallery at a fixed child position. The editor
  // takeover hides the card section; it must NEVER change the SHAPE of what this
  // component returns. An `if (editing) return <WidgetGallery/>` early return would
  // change the returned element type between renders, so React unmounts and
  // remounts WidgetGallery on the very first Edit or Add click — the editor never
  // opens (its `view` state is thrown away) and "+ Add widget" loses the newborn to
  // the unmount guard at WidgetGallery.jsx:225-235.
  return (
    <div className={`sp-display-workspace${!editing && screen === 'gallery' ? ' sp-display-workspace--list' : ''}`}>
      {!editing && screen === 'gallery' && (
        <div className="lib-sect-hd">
          <div className="sp-sect-t">Dashboard</div>
          <button type="button" className="sp-btn sp-btn-s" onClick={() => setScreen('library')}>
            Library
          </button>
        </div>

      )}
      {screen === 'library'
        ? (
          <LibraryScreen
            onBack={() => setScreen('gallery')} display={display} onChange={onChange}
            casEnabled={casEnabled} casReason={casReason} onCasSaved={onCasSaved}
          />
        )
        : (!editing && (
      <section className="sp-sect sp-display-sections">
        {/* "Page sections", not "Blocks" (post-release UX round, 2026-08-16):
            phase 4 made "block" the LIBRARY kind — a shared group of tiles — so
            this header was the same word as the BLOCK badge one screen away.
            These four are the page's functional engines; the owner renamed the
            header, the cards themselves are unchanged. */}
        <div className="blib-group-t">Page sections</div>
        <div className="blib-cards">
          {FUNCTIONAL_BLOCK_IDS.map((id) => {
            // Fall back to the raw id rather than destructuring undefined: a fifth
            // functional block added to the shared list without a card entry here
            // would otherwise throw inside render, and DashErrorBoundary would
            // swallow the WHOLE dashboard over a missing label. The parity pin in
            // tests/dashboard/gallery-cards.test.js is what actually catches it.
            const [name, desc] = BLOCK_META[id] || [id, ''];
            const on = isOn(id);
            return (
              <GalleryCard
                key={id} name={name} desc={desc} on={on}
                wide={id === 'lineItems' && customizeOpen}
                cardRef={id === 'lineItems' ? lineItemsCardRef : null}
                // hasSwitch is the one gate for "does this id get a control at all"
                // — the same closed-domain question the asserting writer asks, and the
                // same gate Layout mode's chip uses.
                control={hasSwitch(id) && (
                  <Switch on={on} label={name} disabled={isBusy(id)}
                    onChange={(v) => setOn(id, v)} />
                )}
              >
                {id === 'lineItems' && (
                  <label className="blib-card-opt">
                    <input type="checkbox" checked={!!showDescription}
                      onChange={onShowDescriptionToggle} />
                    Show description
                  </label>
                )}
                {id === 'lineItems' && (
                  <>
                    <button type="button" className="blib-card-opt lic-toggle" aria-expanded={customizeOpen}
                      aria-controls="lic-editor" onClick={() => setCustomizeOpen((v) => !v)}>
                      <i className={`lic-toggle-icon ${customizeOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}`} aria-hidden="true" />
                      Customize
                    </button>
                    {customizeOpen && (
                      <div id="lic-editor">
                        <LineItemsCustomize value={lineItems} onChange={onLineItemsChange} hasConversions={hasConversions} />
                      </div>
                    )}
                  </>
                )}
              </GalleryCard>
            );
          })}
        </div>

        <div className="blib-hint">Switches apply for everyone immediately.</div>
      </section>
        ))}

      {/* The Library and the History are SECOND SCREENS, so the gallery must go away
          visually — and it must NOT unmount, or opening one mid-edit throws away the
          editor's state and the newborn guard deletes a widget the user was adding
          (the note above). Hidden with a class, mounted throughout. The wrapper is
          ALWAYS a div, so WidgetGallery's position and identity never change. */}
      <div className={screen === 'gallery' ? 'sp-display-widgets' : 'lib-hidden'}>
        <WidgetGallery display={display} onChange={onChange}
          onEditingChange={handleEditing} onDraftInvalidChange={onDraftInvalidChange}
          onWidgetDraftInvalidChange={onWidgetDraftInvalidChange}
          draftCm360Configured={draftCm360Configured}
          openWidgetId={openWidgetId} savedEpoch={savedEpoch} savedDisplay={savedDisplay} onOpened={onOpened}
          editorRequest={editorRequest}
          submittedDisplayRef={submittedDisplayRef} resetEpoch={resetEpoch}
          casEnabled={casEnabled} casReason={casReason} onCasSaved={onCasSaved} />
      </div>
    </div>
  );
}
