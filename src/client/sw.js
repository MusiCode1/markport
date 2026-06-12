/**
 * Service Worker — bootstrap cache (stale-while-revalidate)
 *
 * Intercepts GET /api/bootstrap requests and serves from CacheStorage,
 * firing a background revalidation in parallel. On repeat visits this
 * eliminates the ~200–800 ms server round-trip with a <5 ms cache hit.
 *
 * Cache is keyed by full URL (includes ?vault=...&full=1) so each vault
 * gets its own entry. Bump CACHE_NAME to evict all entries on SW update.
 */

const CACHE_NAME = 'ow-bootstrap-v1';

// ── Lifecycle ────────────────────────────────────────────────────────────────

self.addEventListener('install', () => {
  // Skip the waiting phase so this SW takes over immediately on install,
  // without needing a second page load.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Evict any cache entries from older SW versions.
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('ow-bootstrap-') && k !== CACHE_NAME)
          .map(k => {
            console.log('[ow-sw] evicting old cache:', k);
            return caches.delete(k);
          }),
      ))
      // Take control of all open tabs immediately so the cache is used
      // on the very next fetch, even on the page that registered us.
      .then(() => self.clients.claim()),
  );
});

// ── Fetch interception ───────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only cache /api/bootstrap — skip the /status progress-polling sub-route.
  if (!url.pathname.startsWith('/api/bootstrap')) return;
  if (url.pathname.includes('/status')) return;

  event.respondWith(staleWhileRevalidate(request));
});

// ── Strategy ─────────────────────────────────────────────────────────────────

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Always kick off a background network fetch to keep the cache fresh.
  // Don't await it — we return the cached response immediately.
  const networkFetch = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
        console.log('[ow-sw] bootstrap cache updated:', new URL(request.url).search);
      }
      return response;
    })
    .catch(err => {
      console.warn('[ow-sw] bootstrap revalidation failed:', err.message);
      return null;
    });

  if (cached) {
    console.log('[ow-sw] bootstrap cache HIT:', new URL(request.url).search);
    return cached;
  }

  // Cache miss (first visit) — wait for the network.
  console.log('[ow-sw] bootstrap cache MISS:', new URL(request.url).search);
  const response = await networkFetch;
  if (!response) {
    throw new Error('[ow-sw] bootstrap fetch failed with no cached fallback');
  }
  return response;
}
