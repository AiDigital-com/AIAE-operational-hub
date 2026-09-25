import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../style/cn";
import { CloseIcon } from "../icons/icons";
import "./modal.css";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openModalCount = 0;
let previousBodyOverflow = "";
let previousBodyPaddingRight = "";
const BODY_OPEN_CLASS = "modal-open";

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
    document.body.classList.add(BODY_OPEN_CLASS);
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
    document.body.classList.remove(BODY_OPEN_CLASS);
  }
}

/**
 * A generic overlay + card modal: closes on Esc, an overlay click, or its own header close button,
 * traps Tab focus inside the card, and focuses the card's first focusable element on open. The close
 * button lives here (not per-caller) so every modal gets one consistently and none has to float a
 * one-off button over the title this primitive already draws. Callers supply their own body content
 * (including any footer actions) as `children` — this primitive owns only the shell.
 *
 * PORTALED to `document.body`. Some callers (the sidebar's Account Settings trigger, for one) live
 * inside `<aside class="sidebar">`, which is `position: sticky` and so opens its own stacking
 * context — rendered in place, the overlay's z-index would only ever be compared against the
 * sidebar's own children, and the page content beside it (a later DOM sibling of the sidebar) would
 * paint over the whole thing regardless of that number. Portaling escapes that ancestor instead of
 * trying to out-z-index it, the same fix the retired SPA's `AccountSettings.jsx` used and the same
 * pattern already established here by `Tooltip` and `PersonPicker`. `document.documentElement` (not
 * `document.body`) carries `data-theme`, so a portaled card still inherits the right theme tokens.
 */
export function Modal({ open, onClose, title, subtitle, children, className }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Focus lands ONCE per opening, in its own effect keyed on `open` alone.
  //
  // It used to live in the effect below, which also depends on `onClose` — and almost every caller
  // passes that as an inline arrow, so it is a new function on every render and the effect re-ran
  // constantly. That was harmless while the first focusable element was whatever control the body
  // began with: re-focusing the field someone was already typing in changes nothing. Adding the
  // header's close button put a NEW element first, and the same re-run then yanked focus out of the
  // body on every keystroke — typing into any modal that re-renders as you type silently stopped
  // working. Splitting the effect is the fix; the Tab trap below still needs the current `onClose`.
  //
  // Prefer the first control in the BODY over the close button, so opening a modal puts the caret
  // where the work is rather than on the way out.
  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    if (!card) return;
    const focusable = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const target = focusable.find((el) => !el.closest(".modal__header")) ?? focusable[0];
    target?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    lockBodyScroll();
    const card = cardRef.current;

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

  return createPortal(
    <div
      className="modal__overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={cardRef} className={cn("modal__card", className)} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <h3 className="modal__title">{title}</h3>
          <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {subtitle && <p className="modal__sub">{subtitle}</p>}
        {children}
      </div>
    </div>,
    document.body
  );
}
