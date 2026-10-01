// workspace/src/lib/menu-placement.js
// Pure function: where a dropdown panel goes, given its trigger's viewport rect.
// Both ⋯ menus render their panel in a portal with `position: fixed` (so no
// ancestor's overflow can clip it), which means both have to answer the same two
// questions — how far right may it sit, and is there room below the trigger.
//
// `panelH` is whatever the caller knows. Before the panel exists that is an
// estimate; after it mounts it is the measured height. The FLIP case must be
// re-placed from the measurement: it positions the panel's BOTTOM against the
// trigger, so every pixel of estimate error moves the panel by that pixel. The
// downward case is immune (its TOP is pinned to the trigger), which is why the
// estimate alone was good enough for years and the upward flip drifted.

/**
 * @param {{top:number,bottom:number,right:number}} trigger viewport rect of the button
 * @param {{panelW:number,panelH:number,viewportW:number,viewportH:number,gap?:number,edge?:number}} opts
 *   `gap` — space between trigger and panel; `edge` — minimum viewport margin.
 * @returns {{top:number,left:number,flipped:boolean}}
 */
export function placeMenu(trigger, { panelW, panelH, viewportW, viewportH, gap = 4, edge = 8 }) {
  // Right-aligned to the trigger, then clamped to the viewport. If the viewport is
  // narrower than the panel the left margin wins and the panel overflows right —
  // deliberate: a menu pinned to the left edge is at least readable from its start.
  const left = Math.max(edge, Math.min(trigger.right - panelW, viewportW - panelW - edge));
  const below = trigger.bottom + gap;
  // Flip up only if the panel actually FITS up there. With no room either way it
  // stays below and overflows, rather than covering the trigger it belongs to.
  const flipped = (below + panelH > viewportH - edge) && (trigger.top - panelH - gap > edge);
  return { top: flipped ? trigger.top - panelH - gap : below, left, flipped };
}
