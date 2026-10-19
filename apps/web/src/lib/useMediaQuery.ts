import { useSyncExternalStore } from 'react';

/** Tailwind's `lg`: the width from which the app shows its sidebar instead of the tab bar. */
export const DESKTOP_QUERY = '(min-width: 1024px)';
/** Tailwind's `md`: dashboards switch from the stacked phone layout to the 12-column grid. */
export const GRID_QUERY = '(min-width: 768px)';

/**
 * Whether a media query matches, kept in step with the window. Where matchMedia doesn't exist
 * (jsdom in unit tests) it reports `fallback`: tests see the desktop layout.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia !== 'function') return () => undefined;
      const mq = matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => (typeof matchMedia === 'function' ? matchMedia(query).matches : fallback),
  );
}
