'use client';

import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

const KEY = 'personal-airspace:view';
type Preference = 'auto' | 'simple' | 'full';
const parsePreference = (value: string | null): Preference =>
  value === 'simple' || value === 'full' ? value : 'auto';

let preference: Preference | undefined;
const listeners = new Set<() => void>();
const connection = () =>
  (
    navigator as Navigator & {
      connection?: EventTarget & { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
const readSimple = () => {
  if (preference === undefined) {
    try {
      preference = parsePreference(localStorage.getItem(KEY));
    } catch {
      preference = 'auto';
    }
  }
  if (preference !== 'auto') return preference === 'simple';
  const network = connection();
  return (
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    Boolean(network?.saveData) ||
    /^(slow-)?2g$/.test(network?.effectiveType ?? '')
  );
};
const serverView = () => null;
const subscribe = (notify: () => void) => {
  listeners.add(notify);
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const network = connection();
  const sync = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) {
      preference = parsePreference(event.newValue);
      notify();
    }
  };
  media.addEventListener('change', notify);
  network?.addEventListener('change', notify);
  addEventListener('storage', sync);
  return () => {
    listeners.delete(notify);
    media.removeEventListener('change', notify);
    network?.removeEventListener('change', notify);
    removeEventListener('storage', sync);
  };
};

/** Server/hydration stays static; resolve browser preferences before lazy 3D mounts. */
export function useViewPreference() {
  const resolved = useSyncExternalStore(subscribe, readSimple, serverView);
  const simple = resolved ?? true;
  const ready = resolved !== null;
  const anchor = useRef<{ id: string; top: number } | null>(null);

  useLayoutEffect(() => {
    document.documentElement.dataset.simpleView = String(simple);
    const saved = anchor.current;
    if (saved) {
      const element = document.getElementById(saved.id);
      if (element)
        scrollTo({
          top: scrollY + element.getBoundingClientRect().top - saved.top,
          behavior: 'instant',
        });
      anchor.current = null;
    }
    return () => {
      delete document.documentElement.dataset.simpleView;
    };
  }, [simple]);

  const toggle = () => {
    // Keep the current section in view when the tall flight collapses. In the
    // flight itself, return to its opening so both modes start coherently.
    const section = [
      ...document.querySelectorAll<HTMLElement>('main > section[id], footer'),
    ].find((element) => element.getBoundingClientRect().bottom > 0);
    if (section?.id)
      anchor.current = {
        id: section.id,
        top: section.id === 'flight' ? 0 : section.getBoundingClientRect().top,
      };
    const next = simple ? 'full' : 'simple';
    preference = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* The choice still works for this visit. */
    }
    listeners.forEach((notify) => notify());
  };
  return { simple, ready, toggle };
}
