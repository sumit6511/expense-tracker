// Share target (imported by the Workbox-generated sw.js): sharing a photo or PDF to the installed
// app (from the gallery, WhatsApp, a banking app…) POSTs it here. The files wait in a cache, and
// the app opens a new expense with them attached (see src/lib/shared-receipts.ts).

const SHARED_CACHE = 'et-shared-receipts';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const cache = await caches.open(SHARED_CACHE);
        for (const key of await cache.keys()) await cache.delete(key);
        const files = form.getAll('receipt').filter((f) => typeof f !== 'string');
        let i = 0;
        for (const file of files.slice(0, 5)) {
          await cache.put(
            `/shared-receipt/${i++}`,
            new Response(file, {
              headers: {
                'content-type': file.type || 'application/octet-stream',
                'x-file-name': encodeURIComponent(file.name || `receipt-${i}`),
              },
            }),
          );
        }
        const text = [form.get('title'), form.get('text'), form.get('url')]
          .filter((v) => typeof v === 'string' && v.trim())
          .join(' ')
          .slice(0, 500);
        if (text) await cache.put('/shared-receipt/text', new Response(text));
      } catch {
        // Open the app anyway; there's just nothing to attach.
      }
      return Response.redirect('/?shared=1', 303);
    })(),
  );
});
