import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { storage } from '@/lib/utils';

export type ThemePreference = 'light' | 'dark' | 'system';

const KEY = 'et.theme';
const listeners = new Set<() => void>();

function read(): ThemePreference {
  const value = storage.get(KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

function apply(pref: ThemePreference) {
  const dark =
    pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0f1117' : '#0f766e');
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, read, () => 'system' as const);
  const setPreference = useCallback((next: ThemePreference) => {
    storage.set(KEY, next === 'system' ? null : next);
    apply(next);
    for (const l of listeners) l();
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      apply('system');
      for (const l of listeners) l();
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  return { preference, setPreference };
}

/** The theme actually shown right now ('light' or 'dark'). */
export function useThemeClass(): 'light' | 'dark' {
  useTheme();
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light';
}
