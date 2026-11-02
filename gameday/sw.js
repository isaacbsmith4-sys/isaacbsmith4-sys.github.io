// Network-first for everything, falling back to cache when offline.
const CACHE = "gameday-v11";
const SHELL = ["./", "index.html", "app.css?v=11", "js/app.js?v=11", "js/core.js?v=11", "js/data.js?v=11", "js/ui.js?v=11", "js/gamecenter.js?v=11", "js/players.js?v=11", "js/teams.js?v=11", "js/stats.js?v=11", "js/news.js?v=11", "js/calendar.js?v=11", "js/alerts.js?v=11",
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

// tapping a phone alert opens the right page
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const href = e.notification.data?.href || "";
  const url = new URL("./" + (href.startsWith("#") ? href : ""), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    if (c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
