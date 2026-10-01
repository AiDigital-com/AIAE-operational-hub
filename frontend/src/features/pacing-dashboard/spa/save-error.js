// One place says what a failed save means, so the surfaces that write — Layout
// mode's Off/On chip, the gallery's switches, the layout Save, and every library
// action — can never explain the same server answer two different ways.
//
// `stale_settings` is the 409 from the display optimistic lock (db.mjs): someone
// else saved while this view held an older display.rev. The library codes below are
// its equivalents on the /api/library surface (library.mjs). Each has a next step
// the user can act on, so each gets words instead of a code.
//
// Anything NOT in this map passes through verbatim — LayoutMode.jsx, the enabled
// switch and DashGrid all rely on that for the codes with no wording of their own.
//
// Null prototype because the key is a SERVER-supplied string and every caller
// feeds the answer straight into a toast: on a plain literal, an `error` of
// '__proto__' (or 'toString') would look up Object.prototype's member and return
// a non-string, which React refuses to render. Same reflex as shared/lib-refs.js.
const MESSAGES = {
  __proto__: null,
  stale_settings: 'Settings changed by someone else; reload and re-apply',
  stale_entry: 'Someone else changed this library entry; reopen the Library and try again',
  not_yours: 'Only the author, or an admin, can change this library entry',
  library_full: 'Your library is full; delete an entry you no longer need',
  // A push to an entry somebody soft-deleted. Reachable, not theoretical: a deleted
  // entry keeps being DELIVERED so linked tiles go on rendering (§3.3), so the card
  // still offers Push and the 404 arrives only when the write is attempted. The
  // wording leads with the reassurance, because the tile is fine. No other
  // saveErrorText caller can hit it — the display-settings route answers
  // bad_id / no_access / payload_too_large / stale_settings, never not_found.
  not_found: 'This library entry was removed; your tile keeps working, but updates can no longer be pushed to it',
  bad_library: 'The server refused this widget; open its editor and check the formula',
  // The display-settings route's commonest refusal, and it reaches THESE surfaces through
  // the Library: adding a block and applying a layout are widgets-carrying saves
  // (LibraryScreen onAddBlock / doApplyLayout), so a member the server will not store
  // toasted the bare word `bad_widgets`. The Settings drawer shows the server's `detail`
  // instead, which names the tile; these surfaces read the code, so it gets words here.
  bad_widgets: 'The server refused one of these widgets; open its editor and check its settings',
  // §9: a CM360 report pinned to a FIXED mapping id names an entity on ONE pacing, so it
  // cannot be shared. Nothing is converted for the author — they switch their own copy to
  // Runtime mapping and share that.
  mapping_not_portable: 'This widget is pinned to this pacing’s mapping; switch it to Runtime mapping before sharing',
  // The §9 stale-writer refusal (db.mjs checkV2Writer): this bundle tried to change a
  // widget built by a newer editor, and the server refused rather than let the old
  // normalizer reduce it. The server also sends a `detail` naming the widget, which the
  // Settings drawer shows verbatim; these surfaces read the code, so it gets words here.
  // The TAIL is word-for-word the server's (db.mjs v2WriterDetail): "…a newer version of the
  // editor; reload the page, then try again". Only the opening differs, because that one
  // names the widget and this one cannot. One person can meet either sentence, and two
  // vocabularies for one answer read like two different problems — so the tail is pinned in
  // tests/library-routes-test.mjs against v2WriterDetail's own output, not just spelled alike.
  v2_writer_required: 'This widget needs a newer version of the editor; reload the page, then try again',
  // The 429 from the `library` rate bucket (api-routes.mjs RATE_WINDOWS). It is a
  // wait, not a failure, and the raw code reads like a crash — so it gets words
  // like every other answer a user can act on.
  too_fast: 'Too many library changes at once; wait a few seconds and try again',
};

export const saveErrorText = (err, fallback) => (
  MESSAGES[err?.message] || err?.message || fallback
);

/**
 * The same answer, except that the SERVER's own sentence wins when it sent one.
 *
 * A `detail` (api.js forwards it onto the error) is the refusal that names its subject —
 * WHICH widget has no Period control, WHICH one was built by a newer editor, WHICH source
 * is wrong. The map above can only say "one of these widgets", because it translates a
 * CODE. So every surface where a v2 tile can be the thing refused reads this one, and the
 * library surfaces — whose codes have their own words and whose wording is pinned — keep
 * `saveErrorText`. The Settings drawer has preferred `detail` by hand since the dim-sources
 * round; this is that preference, made shared.
 *
 * Only a non-empty STRING detail is shown: apiFetch already forwards nothing else, and an
 * object handed to a toast is a render error rather than a message. Everything below the
 * detail is `saveErrorText` itself — one map, one pass-through rule, one fallback.
 */
export const saveErrorDetailText = (err, fallback) => (
  (typeof err?.detail === 'string' && err.detail) || saveErrorText(err, fallback)
);

/**
 * What a refused DISPLAY-CAS SAVE means. The three surfaces that make one — the
 * Library's block Add and layout Apply, and the History screen's Restore — all
 * write the whole arrangement, so all three can meet the same two answers.
 *
 * `display_too_large` is the one refusal with no entry in the map above, and it must
 * not stay a code: it is not a bug, it is a dashboard that has outgrown the 400 KB
 * limit, and the next step (remove some widgets) is something the person can do.
 * Everything else goes through the detail-preferring translator, because these saves
 * carry v2 widgets and a server that names the tile it refused has written a better
 * sentence than any code map can.
 *
 * It lived in LibraryScreen.jsx until the display-history screen needed the same
 * words (spec 2026-09-03); two copies of a refusal is how one situation grows two
 * sentences.
 */
export const casFailureText = (err, fallback) => (
  err?.message === 'display_too_large'
    ? 'Too big: this dashboard would cross the 400 KB display limit. Remove some widgets first.'
    : saveErrorDetailText(err, fallback)
);
