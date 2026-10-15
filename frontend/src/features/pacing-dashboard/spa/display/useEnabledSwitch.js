// workspace/src/hooks/useEnabledSwitch.js
//
// THE `display.enabled` write path, shared by every surface that flips a tile on or
// off: the four functional-block cards in BlockLibrary, the custom-widget cards in
// WidgetGallery, and the view-mode tile ⋯ menu in DashGrid. ONE copy on purpose —
// the live-store read, the closed id-domain assertion, the error wording and the draft
// re-push are four rules that must not drift between them. (It lived beside the
// gallery's Switch.jsx until the dashboard itself became a caller.)
//
// Separate from Switch.jsx, which stays a presentational button with no store,
// router or toast of its own.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { enabledPatch, switchedOn, hasSwitch } from '../display-blocks.js';
// The switch's refusals are the view-pref lane's, and they carry a `detail` that says
// which entry was wrong — a bare `bad_widgets` leaves the person nothing to act on.
import { saveErrorDetailText } from '../save-error.js';
import { useDisplay, useStoreActions } from '../store.js';
import { toast } from '../ui/Toast.jsx';

/**
 * A switch on this path is a VIEW PREFERENCE (spec 2026-08-14 §4): it saves the
 * instant it is flipped, alone, through the per-entry merge lane — never as part of
 * the drawer's Save. That is why `isOn` reads the LIVE store and not the drawer's
 * `display` draft, whose `enabled` map is deliberately frozen at open time.
 *
 * Since phase 3 EVERY tile comes through here, the hero, Finance and the built-in
 * charts included: each is a `w_` widget instance now, so there is no second lane
 * left (display.hero / display.sections / display.charts[] are retired).
 *
 * KNOWN, ACCEPTED (phase 1): with unsaved drawer edits open, the dashboard behind
 * the drawer shows the SERVER display for ~200ms after each flip — the save
 * response is adopted immediately and the draft re-push is the drawer's existing
 * debounced one. The draft is never lost, only briefly not previewed. Removing the
 * blink means an undebounced push, which is the per-keystroke reconcile that
 * debounce exists to prevent.
 *
 * @param {(updater: (cur: object) => object) => void} [onChange] the drawer's display
 *   setter — called with an IDENTITY updater after every save (see below). Optional:
 *   the dashboard's tile ⋯ menu writes through this same path with no drawer draft
 *   to re-push (DashGrid.jsx).
 * @returns {{ isOn: (id: string) => boolean, setOn: (id: string, on: boolean) => Promise<boolean>,
 *   isBusy: (id: string) => boolean }}
 *   `setOn` resolves TRUE only when the switch was actually persisted and FALSE when
 *   the save failed (it has already said so in a toast). An id outside the enabled{}
 *   domain is a caller bug and rejects explicitly instead of pretending to save.
 *   The gallery ignores the answer (the card re-reads the live store); the tile menu
 *   needs it, because "turned off" is a claim about a tile that just vanished.
 */
export function useEnabledSwitch(onChange) {
  const { slug } = useParams();
  const liveDisplay = useDisplay();
  const { saveSettings } = useStoreActions();
  const [busyId, setBusyId] = useState(null);

  const isOn = (id) => switchedOn(liveDisplay, id);
  const isBusy = (id) => busyId === id;

  const setOn = async (id, on) => {
    if (!hasSwitch(id)) {
      throw new TypeError(`Cannot toggle unknown dashboard tile "${String(id)}"`);
    }
    const enabled = enabledPatch(id, on);
    setBusyId(id);
    try {
      await saveSettings(slug, { display: { enabled } });
      // The store adopts the SERVER display wholesale on every save
      // (dashboardStore.js:262-272), which would drop the drawer's unsaved draft out
      // of the live preview behind the drawer. Re-push the draft — IDENTITY updater,
      // so nothing is edited, only the existing debounced push is rescheduled (and
      // it re-reads `enabled` from the live store, so this switch survives it).
      onChange?.((cur) => cur);
      return true;
    } catch (err) {
      toast(saveErrorDetailText(err, 'Could not save the switch'), 'error');
      return false;
    } finally {
      // Clear only OUR id: two quick flips overlap, and a blanket null would let A's
      // response re-enable B's switch while B is still in flight.
      setBusyId((cur) => (cur === id ? null : cur));
    }
  };

  return { isOn, setOn, isBusy };
}
