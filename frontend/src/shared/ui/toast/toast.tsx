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

const AUTO_DISMISS_MS = 6000;

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
      setToasts((current) => [...current, { id, message, variant }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
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
