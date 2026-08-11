/* نبض — self-destructing service worker.
   Purpose: kill any legacy service worker from old deployments that serves
   stale bundles from cache. This SW never caches anything and unregisters
   itself + wipes all caches + forces clients to reload, so the next load is
   always the fresh build with no SW at all. */
const VERSION = "pulse-v6-nuke";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (err) {}
      try {
        await self.registration.unregister();
      } catch (err) {}
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => {
        try { c.navigate(c.url); } catch (err) { c.postMessage({ type: "SW_NUKED" }); }
      });
    })()
  );
});

self.addEventListener("fetch", () => {});
