// workspace/src/components/ui/Toast.jsx
// Toast notification system with pending→success/error lifecycle.
// API: toast(msg, type?) → { update(msg, type), dismiss() }

import { useState, useEffect, useCallback, useRef } from 'react';

let addToastGlobal = null;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Show a toast. Returns a handle to update or dismiss it.
 * @param {string} message
 * @param {'pending'|'success'|'error'|'info'} [type='info']
 * @returns {{ update(msg, type): void, dismiss(): void }}
 */
export function toast(message, type = 'info') {
  if (!addToastGlobal) return { update() {}, dismiss() {} };
  return addToastGlobal(message, type);
}

// ── Hook (mount once in Layout) ─────────────────────────────────────────────

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    // Mark as exiting for animation
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
  }, []);

  const add = useCallback((message, type) => {
    const id = Date.now() + Math.random();

    const handle = {
      update(msg, newType) {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, message: msg, type: newType } : t));
        // Reset auto-dismiss timer
        clearTimeout(timersRef.current[id]);
        if (newType === 'success') timersRef.current[id] = setTimeout(() => dismiss(id), 4000);
        else if (newType === 'error') timersRef.current[id] = setTimeout(() => dismiss(id), 8000);
        else if (newType === 'info') timersRef.current[id] = setTimeout(() => dismiss(id), 4000);
      },
      dismiss() { dismiss(id); },
    };

    setToasts(prev => {
      // Max 3 visible — dismiss oldest non-exiting
      const active = prev.filter(t => !t.exiting);
      if (active.length >= 3) dismiss(active[0].id);
      return [...prev, { id, message, type, exiting: false }];
    });

    // Auto-dismiss for non-pending
    if (type === 'success') timersRef.current[id] = setTimeout(() => dismiss(id), 4000);
    else if (type === 'error') timersRef.current[id] = setTimeout(() => dismiss(id), 8000);
    else if (type === 'info') timersRef.current[id] = setTimeout(() => dismiss(id), 4000);
    // pending — stays until update() or dismiss()

    return handle;
  }, [dismiss]);

  useEffect(() => { addToastGlobal = add; return () => { addToastGlobal = null; }; }, [add]);

  return { toasts, add };
}

// ── Icons ───────────────────────────────────────────────────────────────────

function PendingIcon() {
  return (
    <div
      style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        border: '2px solid var(--border-soft)',
        borderTopColor: 'var(--accent)',
        animation: 'toastSpin .8s linear infinite',
      }}
    />
  );
}

function SuccessIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--status-green)" strokeWidth="2.5" style={{ flexShrink: 0 }}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--status-red)" strokeWidth="2.5" style={{ flexShrink: 0 }}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

const ICON = { pending: PendingIcon, success: SuccessIcon, error: ErrorIcon };

// ── Container ───────────────────────────────────────────────────────────────

export default function ToastContainer({ toasts }) {
  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 200,
      display: 'flex', flexDirection: 'column-reverse', gap: 8,
      pointerEvents: 'none',
    }}>
      {toasts.map(t => {
        const Icon = ICON[t.type] || null;
        return (
          <div
            key={t.id}
            className="text-13"
            style={{
              pointerEvents: 'auto',
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 16px',
              minWidth: 260, maxWidth: 380,
              borderRadius: 'var(--r, 10px)',
              background: 'var(--surface)',
              border: `1px solid ${
                t.type === 'success' ? 'var(--status-green-bold)'
                : t.type === 'error' ? 'var(--status-red-bold)'
                : 'var(--border-soft)'
              }`,
              color: 'var(--text-primary)',
              fontWeight: 500, fontFamily: 'var(--font-sans)',
              boxShadow: '0 8px 32px var(--overlay)',
              animation: t.exiting ? 'toastOut .3s ease forwards' : 'toastIn .3s ease',
            }}
          >
            {Icon && <Icon />}
            <span style={{ flex: 1, lineHeight: 1.3 }}>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
