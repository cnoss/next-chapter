// Service worker: makes the tool work offline.
//
// - App files (HTML, JS, CSS, fonts, icons): served from cache, refreshed in the
//   background. A new deploy shows up on the next start, no version bump needed.
// - Content (content/*.md, digests.json): network first, cache as offline fallback,
//   so a new digest appears as soon as there is a connection.

const CACHE = 'next-chapter-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'app/main.js',
  'app/config.js',
  'app/digest.js',
  'app/storage.js',
  'app/markdown.js',
  'app/styles.css',
  'app/vendor/marked.esm.js',
  'app/fonts/archivo-black-latin-400-normal.woff2',
  'app/fonts/space-mono-latin-400-normal.woff2',
  'app/fonts/space-mono-latin-700-normal.woff2',
  'app/icons/icon-180.png',
  'app/icons/icon-192.png',
];

const CONTENT = ['content/digests.json', 'content/fristen.md', 'content/programme.md'];

const url = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(url));
    // Content is best effort: offline install must not fail because of it.
    await Promise.allSettled(CONTENT.map((path) => cache.add(url(path))));
    try {
      const manifest = await (await fetch(url('content/digests.json'))).json();
      await Promise.allSettled(manifest.digests.map((file) => cache.add(url(`content/digests/${file}`))));
    } catch {
      // Digests get cached on first view instead.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, url('index.html')));
  } else if (request.url.startsWith(url('content/'))) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(fallbackUrl || request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(fallbackUrl || request, { ignoreSearch: true });
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}
