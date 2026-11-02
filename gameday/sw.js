// GAME DAY service worker: fast repeat opens, and something to show when offline.
const CACHE = "gameday-v23";
const SHELL = ["./", "index.html", "app.css?v=23", "js/app.js?v=23", "js/core.js?v=23", "js/data.js?v=23", "js/ui.js?v=23", "js/gamecenter.js?v=23", "js/players.js?v=23", "js/teams.js?v=23", "js/stats.js?v=23", "js/news.js?v=23", "js/calendar.js?v=23", "js/alerts.js?v=23", "js/odds.js?v=23", "js/assistant.js?v=23",
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

// App files have versioned URLs (?v=N), so they're served from cache once fetched. Everything else, including
// your models' files and ESPN, goes to the network first so it's always current, with the cached copy used offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // ESPN and other hosts: straight to the network
  const put = (res) => { if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy))); } return res; };
  if (/\?v=\d+$/.test(url.search)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then(put)));
    return;
  }
  e.respondWith(fetch(e.request).then(put).catch(() => caches.match(e.request)));
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
