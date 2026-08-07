import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import "./toast.css";

type ToastVariant = "error" | "success";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastApi {
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

/**
 * How long a confirmation stays before removing itself.
 *
 * Only confirmations are timed. An error waits to be dismissed by hand: it can arrive while this window is
 * not the one in front, and a failure that has already scrolled past is one nobody can act on or report.
 * Closing it is a deliberate "I have read this", which is the point - a success is worth nothing once the
 * thing it confirms is on screen, so dismissing that by hand would be a chore after every routine save.
 */
const SUCCESS_AUTO_DISMISS_MS = 6000;

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Provides app-wide transient toast notifications. Wrap the app once; consume with {@link useToast}.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant) => {
      nextId.current += 1;
      const id = nextId.current;
      // Errors are not repeated while one is still on screen saying the same thing. They no longer leave on
      // their own, so a retried action that keeps failing would otherwise stack identical notices until they
      // covered the surface the user is trying to fix.
      setToasts((current) =>
        variant === "error" && current.some((toast) => toast.variant === "error" && toast.message === message)
          ? current
          : [...current, { id, message, variant }]
      );
      if (variant === "success") {
        setTimeout(() => dismiss(id), SUCCESS_AUTO_DISMISS_MS);
      }
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      showError: (message) => push(message, "error"),
      showSuccess: (message) => push(message, "success"),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.variant}`} role="alert">
            <span className="toast__message">{toast.message}</span>
            <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Returns the toast API. Throws when used outside {@link ToastProvider}.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
