/** Transactions added on this device a moment ago, so lists can highlight them once. */
const added = new Map<string, number>();
const FRESH_MS = 5000;

export function markFresh(id: string) {
  added.set(id, Date.now());
}

export function isFresh(id: string) {
  const at = added.get(id);
  return at !== undefined && Date.now() - at < FRESH_MS;
}
