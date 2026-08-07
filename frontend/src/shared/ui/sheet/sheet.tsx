import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cn } from "../../style/cn";
import "./sheet.css";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  headerActions?: ReactNode;
  /** A fixed (non-scrolling) row below the header — e.g. a tab bar. */
  tabs?: ReactNode;
  /** A fixed (non-scrolling) row at the bottom — e.g. Reset/Save actions. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A right-side slide-over: closes on Esc or an overlay click, traps Tab focus inside the panel, and
 * focuses the panel's first focusable element on open — the same contract as {@link ../modal/modal}'s
 * `Modal`, just docked to the right edge and full-height instead of centered. Callers supply the tab
 * bar and footer as separate slots (so only the body between them scrolls) and the body content as
 * `children`.
 */
export function Sheet({ open, onClose, title, headerActions, tabs, footer, children, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet__overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} className={cn("sheet__panel", className)} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__head">
          <h3 className="sheet__title">{title}</h3>
          {headerActions && <div className="sheet__head-actions">{headerActions}</div>}
        </div>
        {tabs && <div className="sheet__tabs">{tabs}</div>}
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>
  );
}
