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

/**
 * For a row that scrolls sideways (with the `edge-fade` class): fades the edge where there's
 * more to scroll to, so it's clear the row continues. Use as a ref: `ref={edgeFade}`.
 */
export function edgeFade(el: HTMLElement | null) {
  if (!el) return;
  const update = () => {
    el.toggleAttribute('data-fade-start', el.scrollLeft > 1);
    el.toggleAttribute('data-fade-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };
  update();
  el.addEventListener('scroll', update, { passive: true });
  const resize = new ResizeObserver(update);
  resize.observe(el);
  // Items that appear later (filters waiting on data) change the width too.
  const mutations = new MutationObserver(update);
  mutations.observe(el, { childList: true, subtree: true });
  return () => {
    el.removeEventListener('scroll', update);
    resize.disconnect();
    mutations.disconnect();
  };
}

/** Scrolls a sideways row (never the page) so its selected tab is in view. */
export function revealActive(el: HTMLElement | null) {
  const active = el?.querySelector<HTMLElement>('[data-state="active"]');
  if (!el || !active || el.scrollWidth <= el.clientWidth) return;
  const row = el.getBoundingClientRect();
  const item = active.getBoundingClientRect();
  if (item.left < row.left) el.scrollLeft -= row.left - item.left + 24;
  else if (item.right > row.right) el.scrollLeft += item.right - row.right + 24;
}
