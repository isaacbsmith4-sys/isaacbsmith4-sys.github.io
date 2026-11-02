// Network-first for everything, falling back to cache when offline.
const CACHE = "gameday-v6";
const SHELL = ["./", "index.html", "app.css?v=6", "js/app.js?v=6", "js/core.js?v=6", "js/data.js?v=6", "js/ui.js?v=6", "js/gamecenter.js?v=6", "js/players.js?v=6", "js/teams.js?v=6",
  "manifest.webmanifest", "data/teams.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
