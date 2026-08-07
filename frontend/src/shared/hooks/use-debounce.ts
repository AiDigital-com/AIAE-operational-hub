import { useEffect, useState } from "react";

/**
 * Delays updating the returned value until {@link value} has stopped changing
 * for {@link delayMs} milliseconds. Useful for expensive server-side searches
 * that should not fire on every keystroke.
 *
 * @param value the live value to debounce
 * @param delayMs the quiet period before the debounced value updates
 * @returns the stable, debounced value
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
