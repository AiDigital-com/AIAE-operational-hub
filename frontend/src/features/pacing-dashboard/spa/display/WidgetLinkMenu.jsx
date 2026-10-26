// workspace/src/pages/Dashboard/components/Settings/Widgets/WidgetLinkMenu.jsx
//
// The library LINK LAYER of the Widgets tab (widget-library spec §1 two-way control,
// §1a.2 rename, §6.1 card actions). Everything that reads or writes a tile's `lib` /
// `from` ref lives here: the ⋯ menu the gallery card wears, the five dialogs behind
// it, and the two library WRITES (Share, Push update).
//
// The gallery owns cards, Standard templates and the editor door; this module owns
// user Library identity. Every live `lib` link it handles is `{src:'user', key:<uuid>}`.
//
// THE RULE (phase 2 self-review §2b, and the reason this file exists at all): every
// action here takes the RAW INSTANCE `w`. `r` — the resolution — is read only for the
// NAME and the link STATE. A resolved widget is the entry's definition wearing the
// instance's id, with `lib` and `from` absent by construction: hand one to Detach or
// Reset and it no-ops on a tile that looks perfectly healthy.
//
// Every write rides the caller's `patchWidgets`, which is the drawer's DRAFT. Nothing
// here saves. The dashboard tile's ⋯ has its own copy of Detach and Reset on the
// display-cas lane (DashGrid.jsx) — that surface has no draft to ride.
import { useState } from 'react';
import ConfirmModal from '../ConfirmModal.jsx';
import TileMenu from '../ui/TileMenu.jsx';
import { toast } from '../ui/Toast.jsx';
import { useApi } from '../useApi.js';
import { api } from '../store.js';
import { useStoreActions } from '../store.js';
import {
  headingOf, tileTitle, detachInstance, relinkInstance, stripForShare, hasPacingPins,
  ENTRY_GONE, LINK_DONE,
} from '../library-refs.js';
// Share and Push write the library lane; server detail always beats a generic code.
import { saveErrorDetailText } from '../save-error.js';
// The forward-version door and its one refusal sentence.
import { isFutureWidget, FUTURE_VERSION } from '../report-v2.js';
import { renameWidget } from '../widget-ops.js';
import { useDashboardStore } from '../store.js';
// The visibility choice is the SAME control and the same words the group/layout
// dialog offers (spec 2026-09-04) — one question, one route, one wording.
import { VisibilityPills, ONLY_ME_NOTE, SteadyNote } from './ShareEntryDialog.jsx';

/**
 * @param {Map} resolved      instance id → resolution (useResolvedWidgets)
 * @param {object} libEntries the entries map (useLibraryEntries) — detach needs the
 *                            DEFINITION, not the resolution
 * @param {Function} patchWidgets the gallery's draft writer: (fn(widgets) => widgets)
 * @param {Function} onEditReady  called with an id once a linked tile has been
 *                            detached for editing — the gallery owns the editor view
 */
export function useLibraryLink({ resolved, libEntries, patchWidgets, onEditReady }) {
  // Every dialog holds { widget, title }: the raw INSTANCE it acts on and the name that
  // instance wears on screen. Never one object with the title merged in —
  // detachInstance and relinkInstance read `widget.title` as the user's OWN override
  // (§1a.2), so a widget wearing its entry's name would store an override nobody typed.
  const [renaming, setRenaming] = useState(null);          // {id,title,entryName} | null
  const [confirmReset, setConfirmReset] = useState(null);          // {widget,title} | null
  const [confirmDetachEdit, setConfirmDetachEdit] = useState(null); // {widget,title} | null
  // The two library WRITES (§6.1). `sharing` carries the dialog's own fields; `pushing`
  // is the raw INSTANCE, because its dialog names the ENTRY, not the tile.
  const [sharing, setSharing] = useState(null);   // {widget, name, description, visibility} | null
  const [pushing, setPushing] = useState(null);   // the raw instance | null
  // Both are ONE call each, so one busy flag: the dialogs are modal and only one can be
  // open at a time.
  const [busyLib, setBusyLib] = useState(false);
  // The new/updated entry goes into the store, so the tile resolves it immediately
  // instead of showing "Library entry unavailable" until the next full load (§3.3).
  const { mergeLibraryEntries } = useStoreActions();
  // The viewer, for the author gate on "Push update". One cached GET, deduped for 30 s
  // across every caller. `me` is null until the first response lands, so every read is
  // `me?.user_id`: a gate that starts closed and opens is correct.
  const { data: me } = useApi(() => api.me(), [], { cacheKey: 'me' });

  const replaceWidget = (id, next) => patchWidgets((ws) => ws.map((w) => (w.id === id ? next : w)));

  /** Share/Push accept canonical definitions and refuse only a future-version row. */
  const noLibraryWrite = (w, r) => (
    isFutureWidget(r?.widget || w) ? FUTURE_VERSION : null);

  const doDetach = (w) => {
    const next = detachInstance(w, libEntries);
    // null = the entry never resolved. Detaching into an empty definition would destroy
    // the tile, so say so instead.
    if (!next) { toast(ENTRY_GONE.detach, 'error'); return; }
    replaceWidget(w.id, next);
    toast(LINK_DONE.detached, 'success');
  };

  const doReset = (w) => {
    setConfirmReset(null);
    const r = resolved.get(w.id);
    // Relinking to a key nothing answers would turn a WORKING private copy into a
    // broken tile. The menu already gates on r.entry; this is the belt to that brace.
    if (!r?.entry) { toast(ENTRY_GONE.reset, 'error'); return; }
    const next = relinkInstance(w);
    if (!next) return;
    replaceWidget(w.id, next);
    toast(LINK_DONE.reset, 'success');
  };

  const doRename = () => {
    const { id, title } = renaming;
    setRenaming(null);
    patchWidgets((ws) => ws.map((w) => (w.id === id ? renameWidget(w, title) : w)));
  };

  /**
   * Share (§6.1), to the team or to yourself alone. The order is not negotiable:
   *   1. create the ENTRY through the API — a standalone row that outlives this pacing,
   *      and the only irreversible half;
   *   2. put it in the store, so the tile can resolve it at once;
   *   3. touch the INSTANCE, through the drawer draft like every other edit here.
   * Close the drawer without saving after step 3 and the entry still exists while the
   * tile is simply not linked yet — recoverable. The reverse order would leave a tile
   * pointing at an entry that was never created.
   *
   * THE SHARE RULE — sharing must never silently change the author's own tile.
   * `stripForShare` drops this pacing's line-item and dimension pins, and when it takes
   * something the entry is NOT what this tile shows: re-linking would then drop those
   * filters from under the author. So the pinned case keeps the tile exactly as it is
   * and only records where the entry came from.
   */
  const doShare = async () => {
    const { widget, name, description, visibility } = sharing;
    const source = resolved.get(widget.id)?.widget || widget;
    // Decided BEFORE the call, from what is on screen (THE SHARE RULE above).
    const pinned = hasPacingPins(source);
    // The client strips the pins too, even though the server strips again: one of the
    // two is the authority, both of them are the honest UI.
    const definition = stripForShare(source);
    // UNCONDITIONALLY. `headingOf` ranks a definition's own title ABOVE the entry name,
    // so a title left inside the shared definition shadows the name typed in this dialog
    // on every pacing that adds the entry.
    delete definition.title;
    setBusyLib(true);
    try {
      const res = await api.library.share({
        kind: 'widget',
        name: name.trim(),
        description: description.trim() || null,
        definition,
        visibility,
      }, useDashboardStore.getState().capabilities);
      mergeLibraryEntries({ [res.entry.id]: res.entry });
      // Every toast below reads what LANDED (`res.entry.visibility`), never what was
      // asked for: an older server that stored the default must not be described as
      // having stored the choice.
      const onlyMe = res.entry.visibility === 'private';
      if (pinned) {
        // The entry is a GENERALIZED version of this tile. The tile keeps what it had —
        // filters included — and only remembers where the entry came from.
        replaceWidget(widget.id, { ...widget, from: { src: 'user', key: res.entry.id } });
        toast(onlyMe
          ? `“${res.entry.name}” is in your library. Shared without this pacing’s filters, so your tile keeps them.`
          : `“${res.entry.name}” is in the team library. Shared without this pacing’s filters — your tile keeps them.`, 'success');
      } else {
        // The link is minted by relinkInstance — the ONE place that knows which instance
        // attributes ride a link (a composite's sizing profile, a v2 widget's schemaVersion
        // and datasetType) and in the validator's stored key order. Hand-minting here used
        // to drop `profile`: the grid sizes a tile from the instance before anything
        // resolves, absent means card, and the profile-less link is what got SAVED — so
        // sharing a section tile silently reflowed it to card size, permanently.
        replaceWidget(widget.id, relinkInstance({ ...widget, from: { src: 'user', key: res.entry.id } }));
        toast(onlyMe
          ? `“${res.entry.name}” is in your library. Only you see it.`
          : `“${res.entry.name}” is in the team library.`, 'success');
      }
      setSharing(null);
    } catch (err) {
      toast(saveErrorDetailText(err, 'Could not share this widget'), 'error');
    } finally {
      setBusyLib(false);
    }
  };

  // Enter commits, like every other one-field dialog here. Guarded by the same condition
  // as the Share button: a dialog whose button is disabled must not submit from the
  // keyboard either.
  const onShareKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!busyLib && sharing?.name.trim()) doShare();
  };

  /**
   * Push update to library (§6.1): the author re-snapshots their own entry from this
   * private copy, and the tile follows the entry again. `updated_at` is the optimistic-
   * lock token — the exact microsecond TEXT the server handed out, never a re-formatted
   * Date, or the CAS can never match (library.mjs header).
   */
  const doPush = async (w) => {
    const entry = resolved.get(w.id)?.entry;
    if (!entry) { toast(ENTRY_GONE.push, 'error'); return; }
    const pinned = hasPacingPins(w);
    const definition = stripForShare(w);
    delete definition.title;
    setBusyLib(true);
    try {
      const res = await api.library.update(entry.id, {
        name: entry.name,
        description: entry.description,
        definition,
        updated_at: entry.updated_at,
      }, useDashboardStore.getState().capabilities);
      mergeLibraryEntries({ [res.entry.id]: res.entry });
      if (pinned) {
        toast(`“${res.entry.name}” updated for everyone who uses it. Your tile keeps this pacing’s filters, so it stays a private copy.`, 'success');
      } else {
        const linked = relinkInstance(w);
        if (linked) replaceWidget(w.id, linked);
        toast(`“${res.entry.name}” updated for everyone who uses it.`, 'success');
      }
      setPushing(null);
    } catch (err) {
      toast(saveErrorDetailText(err, 'Could not update the library entry'), 'error');
    } finally {
      setBusyLib(false);
    }
  };

  /**
   * MAY this tile's editor open? The two answers only the link layer can give:
   *   missing → there is no definition to edit. The editor would open on {id,kind,lib}
   *             and the drawer's Save would drop every field typed into it.
   *   linked  → link-until-touched (§0.6) becomes real here. Detaching silently would be
   *             a surprise; editing without detaching would rewrite an entry other
   *             pacings render. So the user is asked, once, and the detach happens
   *             before the editor opens (the dialog calls onEditReady).
   * Everything else answers true and the CALLER opens its editor.
   */
  const readyToEdit = (w, r) => {
    if (r?.state === 'missing') { toast(ENTRY_GONE.edit, 'error'); return false; }
    if (r?.state === 'linked') { setConfirmDetachEdit({ widget: w, title: tileTitle(r, w) }); return false; }
    return true;
  };

  /**
   * The link control (§1 two-way, §6.1). Every item is gated by the link STATE the
   * resolver reported, so no action is ever offered that cannot work:
   *   linked         → Detach
   *   edited         → Reset, but only while its entry still RESOLVES
   *   plain | edited → Share: both are "a definition that is mine"
   *   edited         → Push, for the entry's AUTHOR or an admin (the SERVER's rule)
   * Rename is unconditional — it is view state and never detaches (§1a.2).
   *
   * Reset and Push ALSO demand `entry.kind === 'widget'` (phase 4, T8): `from`
   * may now carry BLOCK provenance — a block Add mints inline copies pointing at
   * the block entry (§3.4) — and resetting a tile INTO a block definition would
   * destroy it, while blocks are re-shared, never pushed (the PUT route is
   * kind-locked server-side, T7).
   *
   * Share and Push accept canonical definitions. Only a definition from a future
   * grammar is disabled with a visible reason.
   */
  const linkMenuFor = (w, r, extraItems = []) => (
    <TileMenu
      label={`${extraItems.length ? 'Widget' : 'Library'} actions: ${tileTitle(r, w)}`}
      items={[
        { key: 'rename', label: 'Rename…',
          // The field opens on the instance's OWN override and nothing else. Prefilling
          // the entry's name would let a confirmed-without-reading dialog store it as a
          // permanent override (§1a.2). `entryName` is what an empty field falls BACK to.
          onSelect: () => setRenaming({
            id: w.id,
            title: w.title || '',
            entryName: r?.entry ? headingOf({ entry: r.entry }, null) : '',
          }) },
        // Any inline instance can be shared as a user-owned Library definition. The
        // label lost "with team" on 2026-09-04: the team is no longer the only
        // answer, and the choice is the first row of the dialog behind it.
        (r?.state === 'plain' || r?.state === 'edited') && { key: 'share', label: 'Share…',
          disabled: !!noLibraryWrite(w, r),
          title: noLibraryWrite(w, r) || undefined,
          onSelect: () => setSharing({
            widget: w,
            name: w.title || (r?.entry ? headingOf({ entry: r.entry }, null) : ''),
            description: '',
            // Team preselected: it is what every entry was before the choice existed.
            visibility: 'team',
          }) },
        r?.state === 'edited' && r.entry && r.entry.kind === 'widget'
          && (me?.user_id === r.entry.owner_id || me?.role === 'admin')
          && { key: 'push', label: 'Push update to library',
            disabled: !!noLibraryWrite(w, r),
            title: noLibraryWrite(w, r) || undefined,
            onSelect: () => setPushing(w) },
        r?.state === 'linked' && { key: 'detach', label: 'Detach from library', onSelect: () => doDetach(w) },
        r?.state === 'edited' && r.entry && r.entry.kind === 'widget'
          && { key: 'reset', label: 'Reset to library version…', onSelect: () => setConfirmReset({ widget: w, title: tileTitle(r, w) }) },
        ...extraItems,
      ]}
    />
  );

  // Does the tile being shared carry this pacing's pins? The dialog's note and doShare's
  // branch must give the same answer, so it is ONE expression read from one resolution.
  const sharePinned = !!sharing && hasPacingPins(resolved.get(sharing.widget.id)?.widget || sharing.widget);

  const dialogs = (
    <>
      {/* Two wordings for two situations, because one of them would be a lie: a tile
          with a library entry can hand its name BACK by clearing the field, a hand-made
          one has nothing to hand it back to. */}
      {renaming && (
        <ConfirmModal
          title="Rename tile"
          message={renaming.entryName
            ? 'The name is yours alone — it does not change the library entry, and it never detaches this tile.'
            : 'The name is shown to everyone who can see this pacing. It changes nothing about what the tile draws.'}
          confirmLabel="Rename"
          confirmColor="var(--accent)"
          onConfirm={doRename}
          onCancel={() => setRenaming(null)}
        >
          <input
            className="sp-inp sp-inp--sans" type="text" autoFocus maxLength={80}
            value={renaming.title}
            placeholder={renaming.entryName
              ? `Leave empty to use the library name: ${renaming.entryName}`
              : 'A name for this tile'}
            onChange={(e) => setRenaming((cur) => ({ ...cur, title: e.target.value }))}
            // Enter commits, like every other one-field dialog. Not an implicit form
            // submit: ConfirmModal's buttons live outside anything this could wrap.
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doRename(); } }}
          />
        </ConfirmModal>
      )}

      {confirmReset && (
        <ConfirmModal
          title="Reset to library version?"
          message={`“${confirmReset.title}” goes back to following its library entry. Every change made to it here is discarded.`}
          confirmLabel="Reset"
          onConfirm={() => doReset(confirmReset.widget)}
          onCancel={() => setConfirmReset(null)}
        />
      )}

      {/* Share (§6.1). The note is the honest half of THE SHARE RULE: it says, before
          anything is written, what will happen to the tile the user is looking at.
          Always present, in one of two wordings — a note that appears only sometimes
          would move the two fields above it. */}
      {sharing && (
        <ConfirmModal
          title="Add widget to the library"
          // The note follows the choice, the same way the group/layout dialog's
          // does: the "everyone in the company" sentence is the one Only me makes
          // false, so it is the one that is replaced. Through SteadyNote, so the
          // swap does not resize the dialog under the pointer that made it.
          message={(
            <SteadyNote
              value={sharing.visibility}
              options={[
                ['team', 'Everyone in the company can add this widget to their own pacings. It is a standalone copy — deleting this pacing will not remove it.'],
                ['private', ONLY_ME_NOTE],
              ]}
            />
          )}
          confirmLabel="Share"
          confirmColor="var(--accent)"
          loading={busyLib}
          disabled={busyLib || !sharing.name.trim()}
          onConfirm={doShare}
          onCancel={() => setSharing(null)}
        >
          <div className="lib-form">
            <VisibilityPills
              value={sharing.visibility}
              onChange={(v) => setSharing((cur) => ({ ...cur, visibility: v }))}
            />
            <label className="lib-form-l" htmlFor="lib-share-name">Name</label>
            <input
              id="lib-share-name" className="sp-inp sp-inp--sans" type="text" autoFocus maxLength={80}
              value={sharing.name}
              placeholder="A name for the shared widget"
              onChange={(e) => setSharing((cur) => ({ ...cur, name: e.target.value }))}
              onKeyDown={onShareKey}
            />
            <label className="lib-form-l" htmlFor="lib-share-desc">
              Description <span className="lib-form-opt">optional</span>
            </label>
            <input
              id="lib-share-desc" className="sp-inp sp-inp--sans" type="text" maxLength={240}
              value={sharing.description}
              placeholder="What is it for?"
              onChange={(e) => setSharing((cur) => ({ ...cur, description: e.target.value }))}
              onKeyDown={onShareKey}
            />
            {/* The clean case forks on the choice too (2026-09-04): under Only me
                nobody else can take this entry out of the library, so "the same as
                for everyone else" compares the reader to nobody. `sharePinned`
                cannot change while the dialog is open, so only the inner pair can
                swap, and it swaps at a steady height. */}
            <p className="lib-form-note">
              {sharePinned
                ? 'This pacing’s line-item and dimension filters are not shared — they mean nothing on another campaign — so your own tile keeps them and stays a private copy. Channel and period settings go with the entry.'
                : (
                  <SteadyNote
                    value={sharing.visibility}
                    options={[
                      ['team', 'Your own tile will follow this entry from now on, so editing it later makes it a private copy — the same as for everyone else.'],
                      ['private', 'Your own tile will follow this entry from now on, so editing it later makes it a private copy.'],
                    ]}
                  />
                )}
            </p>
          </div>
        </ConfirmModal>
      )}

      {/* Push (§6.1). Two wordings again, because with pins present the tile does NOT go
          back to following the entry — and saying it does would be a lie the user could
          only catch by watching the badge. */}
      {pushing && (
        <ConfirmModal
          title="Push update to library?"
          message={`Every tile that follows “${resolved.get(pushing.id)?.entry?.name || 'this entry'}” will show your version from now on. ${
            hasPacingPins(pushing)
              ? 'This pacing’s line-item and dimension filters are not sent, so your tile stays a private copy.'
              : 'This tile goes back to following it.'}`}
          confirmLabel="Push update"
          confirmColor="var(--accent)"
          loading={busyLib}
          disabled={busyLib}
          onConfirm={() => doPush(pushing)}
          onCancel={() => setPushing(null)}
        />
      )}

      {confirmDetachEdit && (
        <ConfirmModal
          title="Edit this tile?"
          message={`“${confirmDetachEdit.title}” currently follows a library entry. Editing makes it a private copy — it stops following the entry, so the author’s updates no longer arrive. You can reset it later from this card’s ⋯ menu.`}
          confirmLabel="Edit"
          confirmColor="var(--accent)"
          onConfirm={() => {
            const w = confirmDetachEdit.widget;
            setConfirmDetachEdit(null);
            const next = detachInstance(w, libEntries);
            if (!next) { toast(ENTRY_GONE.edit, 'error'); return; }
            replaceWidget(w.id, next);
            onEditReady(w.id);
          }}
          onCancel={() => setConfirmDetachEdit(null)}
        />
      )}
    </>
  );

  return { linkMenuFor, readyToEdit, dialogs };
}
