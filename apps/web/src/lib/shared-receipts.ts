/**
 * Files shared to the installed app (see public/share-sw.js): taken once, then forgotten.
 */
const SHARED_CACHE = 'et-shared-receipts';

export async function takeSharedReceipts(): Promise<{ files: File[]; text: string }> {
  if (!('caches' in window)) return { files: [], text: '' };
  const cache = await caches.open(SHARED_CACHE);
  const files: File[] = [];
  let text = '';
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!response) continue;
    if (new URL(request.url).pathname === '/shared-receipt/text') {
      text = await response.text();
    } else {
      const name = decodeURIComponent(response.headers.get('x-file-name') ?? 'receipt');
      const type = response.headers.get('content-type') ?? '';
      files.push(new File([await response.blob()], name, { type }));
    }
    await cache.delete(request);
  }
  return { files, text };
}
