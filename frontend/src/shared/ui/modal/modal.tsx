import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cn } from "../../style/cn";
import "./modal.css";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openModalCount = 0;
let previousBodyOverflow = "";
let previousBodyPaddingRight = "";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

function lockBodyScroll() {
  if (openModalCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousBodyPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0 && document.documentElement.clientWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
  openModalCount += 1;
}

function unlockBodyScroll() {
  openModalCount = Math.max(openModalCount - 1, 0);
  if (openModalCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
    document.body.style.paddingRight = previousBodyPaddingRight;
  }
}

/**
 * A generic overlay + card modal: closes on Esc or an overlay click, traps Tab focus inside the card,
 * and focuses the card's first focusable element on open. Callers supply their own body content
 * (including any footer actions) as `children` — this primitive owns only the shell.
 */
export function Modal({ open, onClose, title, subtitle, children, className }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    lockBodyScroll();
    const card = cardRef.current;
    const focusable = card?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !card) return;
      const focusables = card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
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
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      unlockBodyScroll();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal__overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={cardRef} className={cn("modal__card", className)} role="dialog" aria-modal="true" aria-label={title}>
        <h3 className="modal__title">{title}</h3>
        {subtitle && <p className="modal__sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
