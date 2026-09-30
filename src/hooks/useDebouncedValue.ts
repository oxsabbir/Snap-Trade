import { useEffect, useState } from 'react';

/**
 * Search filters and re-renders the whole list on every keystroke, so typing a seven letter query
 * would scan the market list and rebuild the rows seven times over for one visible result. Holding
 * the value back briefly collapses a typing burst into a single pass. The text field keeps its own
 * immediate state, so the keyboard still feels instant.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}