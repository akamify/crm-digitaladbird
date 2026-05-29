/**
 * Service-worker killer.
 *
 * If any browser ever cached a real service worker for this origin (e.g. from a
 * previous PWA-enabled build), it would intercept fetches and serve stale assets,
 * causing the "works in Chrome but blank in Edge" / "old build keeps loading"
 * inconsistency.
 *
 * This file is requested whenever an old SW tries to update itself. Replacing
 * it with an empty SW that immediately unregisters itself and deletes every
 * Cache Storage entry cleans up stale state on every page load.
 *
 * Once all users have refreshed at least once with this killer in place, the
 * SW lifecycle is fully gone and the browser falls back to plain HTTP caching
 * (which is now controlled by the no-cache headers in next.config.js).
 */
self.addEventListener('install', function (event) {
  // Activate immediately — don't wait for the old worker to release control.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      // Drop every cache this origin ever stored.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      } catch (_) { /* no Cache Storage support */ }

      // Take control of any open tabs so we can release them.
      try { await self.clients.claim(); } catch (_) {}

      // Force every active client to reload — they'll re-fetch with no SW.
      try {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        clients.forEach(function (client) {
          if ('navigate' in client) {
            try { client.navigate(client.url); } catch (_) {}
          }
        });
      } catch (_) {}

      // Then unregister this worker itself.
      try { await self.registration.unregister(); } catch (_) {}
    })()
  );
});

// Pass-through fetch — never serve from any cache.
self.addEventListener('fetch', function () { /* let the network handle it */ });
