import { createContext, useContext } from "react";

/** Read/write access to the sidebar's collapsed state. */
export interface SidebarCollapse {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

/**
 * The sidebar's collapsed state, shared with the pages inside it.
 *
 * The sidebar belongs to the shell and is normally the user's own toggle to work. A page reaches for
 * this only when its own layout needs the width - the Reporting tab's expanded table is the one case -
 * and is expected to put back whatever it found.
 */
export const SidebarCollapseContext = createContext<SidebarCollapse | null>(null);

/** Ignored outside the shell (a page rendered on its own in a test), rather than throwing: no sidebar
 * to collapse is a perfectly good outcome for a caller that only wants more room. */
const NO_SIDEBAR: SidebarCollapse = { collapsed: false, setCollapsed: () => {} };

/**
 * The sidebar's collapsed state, or an inert stand-in when there is no shell around this component.
 *
 * @return the collapse handle
 */
export function useSidebarCollapse(): SidebarCollapse {
  return useContext(SidebarCollapseContext) ?? NO_SIDEBAR;
}
