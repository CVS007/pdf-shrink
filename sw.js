const CACHE = 'pdf-shrink-v1';
const SHELL = [
  './',
  'index.html',
  'app.js',
  'compress.js',
  'manifest.json',
  'vendor/pdf.min.mjs',
  'vendor/pdf.worker.min.mjs',
  'vendor/pdf-lib.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'shared-inbox').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // A PDF shared in from WhatsApp/email arrives here as a POST. Stash it
  // and redirect to the app, which picks it up and clears the stash.
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.get('file');
        if (file) {
          const cache = await caches.open('shared-inbox');
          await cache.put(
            '/shared-file',
            new Response(file, { headers: { 'x-filename': file.name || 'shared.pdf' } }),
          );
        }
      } catch (_) { /* fall through to the app either way */ }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET') return;

  // App shell is fully offline; anything else falls back to the network.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request)),
  );
});
