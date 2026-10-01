import { createContext, useContext } from 'react';

// Navigation belongs to the builder, which owns the control anchors and the
// content selection guard. Standalone cards retain their local settings panels.
export const ControlNavigationContext = createContext(null);
export const ControlNavigationProvider = ControlNavigationContext.Provider;
export const useControlNavigation = () => useContext(ControlNavigationContext);
