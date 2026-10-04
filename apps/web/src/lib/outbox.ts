import type { CreateTransactionInput } from '@et/shared';
import { useSyncExternalStore } from 'react';
import { ApiError, api } from './api';
import { storage } from './utils';

/**
 * Transactions added while offline wait here (in localStorage) and are sent when the
 * connection is back. Each carries the id chosen on this device, and the API treats a repeated
 * id as the same transaction, so sending twice after a flaky connection can't duplicate it.
 */
export interface OutboxItem {
  id: string;
  /** Who recorded it: only sent while they're signed in (missing on items from older versions). */
  userId?: string;
  workspaceId: string;
  body: CreateTransactionInput & { id: string };
  createdAt: string;
  /** Why the server refused it, if it did (it stays until retried or discarded). */
  error?: string;
}

const KEY = 'et.outbox.v1';
const listeners = new Set<() => void>();
let cache: OutboxItem[] | null = null;

function read(): OutboxItem[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(storage.get(KEY) ?? '[]') as OutboxItem[];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: OutboxItem[]) {
  cache = items;
  storage.set(KEY, items.length ? JSON.stringify(items) : null);
  for (const l of listeners) l();
}

export const outbox = {
  list: read,
  add(item: Omit<OutboxItem, 'createdAt'>) {
    write([
      ...read().filter((i) => i.id !== item.id),
      { ...item, createdAt: new Date().toISOString() },
    ]);
  },
  remove(id: string) {
    write(read().filter((i) => i.id !== id));
  },
  clear() {
    write([]);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

// Other tabs of the app share the same queue.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    cache = null;
    for (const l of listeners) l();
  });
}

export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(outbox.subscribe, read, read);
}

/** Whether `userId` may send this item (someone else's stays put, unsent). */
export const belongsTo = (item: OutboxItem, userId: string) =>
  !item.userId || item.userId === userId;

let flushing: Promise<{ sent: number; failed: number }> | null = null;

/**
 * Sends queued transactions in order. Stops at the first network failure (still offline);
 * items the server rejects are kept with the reason so nothing is silently lost.
 */
export function flushOutbox(userId: string): Promise<{ sent: number; failed: number }> {
  flushing ??= (async () => {
    let sent = 0;
    let failed = 0;
    for (const item of read()) {
      if (item.error || !belongsTo(item, userId)) continue;
      try {
        await api(`/workspaces/${item.workspaceId}/transactions`, {
          method: 'POST',
          body: item.body,
        });
        outbox.remove(item.id);
        sent++;
      } catch (err) {
        // Offline, or signed out meanwhile: keep it for later rather than marking it failed.
        if (err instanceof ApiError && (err.status === 0 || err.status === 401)) break;
        failed++;
        write(
          read().map((i) =>
            i.id === item.id
              ? { ...i, error: err instanceof Error ? err.message : 'Could not be saved' }
              : i,
          ),
        );
      }
    }
    return { sent, failed };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export function retryOutboxItem(id: string, userId: string) {
  write(read().map((i) => (i.id === id ? { ...i, error: undefined } : i)));
  return flushOutbox(userId);
}

/** Is this error "couldn't reach the server" (as opposed to the server saying no)? */
export function isOffline(err: unknown) {
  return (err instanceof ApiError && err.status === 0) || !navigator.onLine;
}
