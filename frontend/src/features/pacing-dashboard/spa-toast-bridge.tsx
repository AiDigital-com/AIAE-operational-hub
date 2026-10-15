/**
 * Pacing's moved code reports through its own `toast()` (`spa/ui/Toast.jsx`): a module-level sink
 * that its `useToast` hook registers, which the retired SPA mounted once in its layout. Nothing here
 * mounted it, so every notice the moved code raised - a refused save, a shared layout - went nowhere.
 *
 * This mounts that hook and shows what it collects as this app's own toasts, rather than Pacing's
 * toast stack: the furniture around the moved code is this app's (the same call `widgets/tile-menu.tsx`
 * makes for the kebab). Pacing's four kinds map onto this app's two: an error is an error; a
 * success or an info notice is a confirmation; a pending notice says nothing until it settles, and
 * its settled form is forwarded then.
 */
import { useEffect, useRef } from "react";
import { useOptionalToast } from "../../shared/ui/toast/toast";
// Moved JS from Pacing's SPA - typed by inference under `allowJs` (see spa/SOURCE.md).
import { useToast as useSpaToasts } from "./spa/ui/Toast.jsx";

interface SpaToast {
  id: number;
  message: string;
  type: "pending" | "success" | "error" | "info";
  exiting?: boolean;
}

export function SpaToastBridge() {
  const hubToast = useOptionalToast();
  const { toasts } = useSpaToasts() as { toasts: SpaToast[] };
  // id → the type last forwarded, so an update to the same notice is shown once per state.
  const forwarded = useRef(new Map<number, string>());

  useEffect(() => {
    if (!hubToast) return;
    for (const toast of toasts) {
      if (toast.exiting || toast.type === "pending") continue;
      if (forwarded.current.get(toast.id) === `${toast.type}:${toast.message}`) continue;
      forwarded.current.set(toast.id, `${toast.type}:${toast.message}`);
      if (toast.type === "error") hubToast.showError(toast.message);
      else hubToast.showSuccess(toast.message);
    }
  }, [toasts, hubToast]);

  return null;
}
