import { type ClassValue, clsx } from 'clsx';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { extendTailwindMerge } from 'tailwind-merge';

// Our extra font sizes (styles.css): without this, tailwind-merge would take `text-2xs` or
// `text-compact` for a text colour and drop the element's real colour class.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ['2xs', 'compact'] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** localStorage that never throws (private mode, blocked storage). */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
};

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `value`, once it has stopped changing for `ms`. */
export function useDebouncedValue<T>(value: T, ms = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Whether a media query matches, kept up to date (e.g. '(min-width: 1024px)'). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
