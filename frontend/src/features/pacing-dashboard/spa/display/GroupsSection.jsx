// workspace/src/pages/Dashboard/components/Settings/Widgets/GroupsSection.jsx
//
// This pacing's GROUPS, listed at the bottom of the Display tab's gallery in the
// language of the widget cards beside them (spec 2026-09-03 group-card, which amends
// the widget-library spec §6.3): a mat in the group's tint with the members sketched
// on it, the name, a Group chip, the member list with its on/off state, a count line,
// and a ⋯ with Rename, Ungroup and Share. Before this it was a bare strip (swatch,
// name, count, Share) that the owner read as "zero information".
//
// Groups are ARRANGEMENT state on the display-cas lane; they never ride the drawer's
// draft. Everything here therefore reads the STORE's display — the copy that updates
// live when a Layout-mode save lands. Rename and Ungroup are the Library's Add/Apply
// kind of write: one cas save against the rev the server holds, gated on a clean
// drawer draft and no live layout session (casEnabled), and followed by onCasSaved so
// the drawer re-bases and a stale draft cannot ride the next preview push over the
// change. They are immediate and shared, and the toasts say so. Share writes the
// LIBRARY, never the pacing. Creating and arranging groups stays Layout-mode work;
// the hint lines below are the road sign.
import { useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import TileMenu from '../ui/TileMenu.jsx';
import ConfirmModal from '../ConfirmModal.jsx';
import { toast } from '../ui/Toast.jsx';
import { api } from '../store.js';
// Two translators: the library's own refusal (Share) names the member it turned down;
// the two display-cas saves (Rename, Ungroup) read the shared cas translator.
import { saveErrorDetailText, casFailureText } from '../save-error.js';
import {
  GROUP_LIMITS, blockShareBlocked, buildBlockEntry, renameGroup, ungroup,
} from '../group-ops.js';
import { tileTitle } from '../library-refs.js';
import { switchedOn } from '../display-blocks.js';
import { useDisplay, useResolvedWidgets, useStoreActions } from '../store.js';
import { currentTiles } from './current-tiles.js';
import ShareEntryDialog from './ShareEntryDialog.jsx';
import { useDashboardStore } from '../store.js';

// How many members the mat sketches. Past that, the last slot is the +N chip the
// Library's block card already wears, so the two mats read the same way.
const MAT_SLOTS = 3;

/** What the mat and the list call a member: the same heading chain the tile prints. */
const memberTitle = (m) => tileTitle(m.r, m.w) || 'Widget';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function countsLine(members) {
  const off = members.filter((m) => !m.on).length;
  const tiles = plural(members.length, 'tile', 'tiles');
  if (!off) return tiles;
  if (off === members.length) return `${tiles} · all off`;
  return `${tiles} · ${off} off`;
}

/**
 * One member on the mat: a static sketch (title + three skeleton lines), never a live
 * mount — the members' own cards above already carry the live previews, and a mat
 * with three more of them would double every chart on the tab.
 */
function MatMember({ m }) {
  return (
    <div className={`gc-m${m.on ? '' : ' gc-m--off'}`}>
      {m.r?.state === 'missing'
        ? <div className="wgal-prev wgal-prev--gone">Library entry unavailable</div>
        : (
          <>
            <div className="gc-mt">{memberTitle(m)}</div>
            <i className="gc-ml gc-ml--m" /><i className="gc-ml gc-ml--s" /><i className="gc-ml gc-ml--m" />
          </>
        )}
    </div>
  );
}

function GroupCard({ g, members, blocked, casEnabled, casReason, busy, onRename, onUngroup, onShare }) {
  const name = g.title || 'Unnamed group';
  // Exactly three fit; more than three shows two and the honest +N for the rest.
  const shown = members.length > MAT_SLOTS ? members.slice(0, MAT_SLOTS - 1) : members;
  const hidden = members.length - shown.length;
  const allOff = members.length > 0 && members.every((m) => !m.on);
  // The version's own refusal wording for the two cas actions is the drawer's: a dirty
  // draft or an open layout session, in the words the Library's Add and Apply use.
  const casTitle = !casEnabled ? (casReason || undefined) : undefined;
  return (
    <div className={`wgal-card gc-card${allOff ? ' wgal-card--off' : ''}`}>
      <div className={`gc-mat grp-${g.bg}`} aria-hidden="true">
        {shown.map((m) => <MatMember key={m.id} m={m} />)}
        {hidden > 0 && <div className="gc-more"><span className="lib-prevmore">+{hidden}</span></div>}
      </div>
      <div className="wgal-meta">
        <span className="wgal-title" title={name}>{name}</span>
        <span className="wgf-kind">Group</span>
        {/* Inside .wgal-acts like the widget card's ⋯, so the two glyphs are one size. */}
        <span className="wgal-acts">
        <TileMenu
          label={`Group actions: ${name}`}
          items={[
            {
              key: 'grename', label: 'Rename…',
              disabled: !casEnabled || busy, title: casTitle,
              onSelect: () => onRename(g),
            },
            {
              key: 'gungroup', label: 'Ungroup',
              disabled: !casEnabled || busy, title: casTitle,
              onSelect: () => onUngroup(g),
            },
            {
              key: 'gshare', label: 'Share…',
              disabled: !!blocked, title: blocked || undefined,
              onSelect: () => onShare(g),
            },
          ]}
        />
        </span>
      </div>
      <div className="gc-members">
        {members.map((m) => (
          <div key={m.id} className="gc-mem">
            <span className="gc-mem-t" title={memberTitle(m)}>{memberTitle(m)}</span>
            {!m.on && <span className="wgal-badge" title="Switched off, not shown on the dashboard">Off</span>}
          </div>
        ))}
      </div>
      <div className="gc-counts">{countsLine(members)}</div>
    </div>
  );
}

export default function GroupsSection({ casEnabled = false, casReason = null, onCasSaved }) {
  const { slug } = useParams();
  const display = useDisplay();   // the STORE — groups are cas-lane state, no draft owns them
  const groups = Array.isArray(display?.groups) ? display.groups : [];
  const widgets = Array.isArray(display?.widgets) ? display.widgets : [];
  const resolved = useResolvedWidgets(widgets);
  const { mergeLibraryEntries, saveSettings } = useStoreActions();
  const tiles = useMemo(() => currentTiles(display || {}), [display]);
  const byId = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);
  const [sharing, setSharing] = useState(null);   // {group, name, description} | null
  const [renaming, setRenaming] = useState(null); // {id, title} | null
  const [busy, setBusy] = useState(false);
  const renameInputRef = useRef(null);

  // Members in tile (y, x) order — the order the dashboard shows them — each with the
  // instance, its library resolution and its switch state.
  const membersOf = (g) => (g.tileIds || [])
    .slice()
    .sort((a, b) => (tiles[a]?.y ?? 0) - (tiles[b]?.y ?? 0) || (tiles[a]?.x ?? 0) - (tiles[b]?.x ?? 0))
    .map((id) => ({ id, w: byId.get(id) || { id }, r: resolved.get(id), on: switchedOn(display, id) }));

  // The LayoutMode share order (T8): create the ENTRY — the only irreversible
  // half — then merge it into the store so previews resolve at once, then toast.
  // `visibility` comes from the dialog's own pills (spec 2026-09-04); the toast
  // reads what LANDED, not what was asked for, so an old server that stored the
  // default still gets described truthfully.
  const doShare = async (visibility) => {
    const { group, name, description } = sharing;
    setBusy(true);
    try {
      const built = buildBlockEntry(group, tiles, resolved);
      const res = await api.library.share({
        ...built, name: name.trim(), description: description.trim() || null, visibility,
      }, useDashboardStore.getState().capabilities);
      mergeLibraryEntries({ [res.entry.id]: res.entry });
      toast(res.entry.visibility === 'private'
        ? `“${res.entry.name}” is in your library. Only you see it.`
        : `“${res.entry.name}” is in the team library.`, 'success');
      setSharing(null);
    } catch (err) {
      toast(saveErrorDetailText(err, 'Could not share this group'), 'error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * ONE display-cas save of the groups list, against the rev the server holds. A
   * groups-only patch carries no widgets, so it needs no writer marker; the per-key
   * merge leaves every other display key alone. Success re-bases the drawer.
   */
  const saveGroups = async (next, pending, done, failed) => {
    if (!casEnabled || busy) return false;
    setBusy(true);
    const t = toast(pending, 'pending');
    try {
      await saveSettings(slug, {
        display: { groups: next },
        display_rev: Number(useDashboardStore.getState().displayRev ?? 0),
      });
      t.update(done, 'success');
      onCasSaved?.('groups');
      return true;
    } catch (err) {
      t.update(casFailureText(err, failed), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const doRename = async () => {
    if (!renaming) return;
    const next = renameGroup(groups, renaming.id, renaming.title);
    setRenaming(null);
    // The same name again is not a change: no save, no rev bump, no Slack line, and no
    // 409 for a colleague's open layout session.
    const before = groups.find((g) => g.id === renaming.id);
    const after = next.find((g) => g.id === renaming.id);
    if (before && after && (before.title || '') === (after.title || '')) return;
    await saveGroups(next, 'Renaming…', 'Renamed for everyone', 'Could not rename this group');
  };
  const doUngroup = (g) => saveGroups(
    ungroup(groups, g.id), 'Ungrouping…', 'Ungrouped for everyone, the tiles stay', 'Could not ungroup',
  );

  return (
    <>
      <div className="blib-group-t">Groups</div>
      {groups.length === 0
        ? <div className="blib-hint wgal-grp-hint">Group widgets in Layout mode.</div>
        : (
          <>
            <div className="wgal">
              {groups.map((g) => (
                <GroupCard
                  key={g.id} g={g} members={membersOf(g)}
                  blocked={blockShareBlocked(g, tiles, resolved)}
                  casEnabled={casEnabled} casReason={casReason} busy={busy}
                  onRename={(grp) => setRenaming({ id: grp.id, title: grp.title || '' })}
                  onUngroup={doUngroup}
                  onShare={(grp) => setSharing({ group: grp, name: grp.title || 'Group', description: '' })}
                />
              ))}
            </div>
            <div className="blib-hint wgal-grp-hint">Arrange groups in Layout mode.</div>
          </>
        )}
      {/* Rename — Layout mode's own dialog, one input, Enter commits; here the commit is
          the cas save itself, so the new name is on the frame for everyone at once. */}
      {renaming && (
        <ConfirmModal
          title="Rename group"
          message="The name shows on the frame’s legend. Leave it empty for an unlabeled frame."
          confirmLabel="Rename"
          confirmColor="var(--accent)"
          loading={busy}
          initialFocusRef={renameInputRef}
          onConfirm={doRename}
          onCancel={() => setRenaming(null)}
        >
          <input
            ref={renameInputRef}
            className="sp-inp sp-inp--sans" type="text" autoFocus maxLength={GROUP_LIMITS.title}
            value={renaming.title}
            placeholder="A name for this group"
            onChange={(e) => setRenaming((cur) => ({ ...cur, title: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doRename(); } }}
          />
        </ConfirmModal>
      )}
      {sharing && (
        <ShareEntryDialog
          mode="block"
          name={sharing.name}
          description={sharing.description}
          busy={busy}
          onChange={(patch) => setSharing((cur) => ({ ...cur, ...patch }))}
          onShare={doShare}
          onCancel={() => setSharing(null)}
        />
      )}
    </>
  );
}
