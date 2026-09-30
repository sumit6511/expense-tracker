import { outbox } from './outbox';

/** The service worker keeps a copy of reference data (accounts, categories…) for offline use. */
export const OFFLINE_CACHE = 'et-reference-data';

/** Forgets everything this device kept for offline use (on sign-out). */
export async function clearOfflineData() {
  outbox.clear();
  try {
    await caches.delete(OFFLINE_CACHE);
  } catch {
    // Cache Storage unavailable (e.g. insecure context): nothing was cached.
  }
}
