// Offline shell: app files cached; API calls always go to the network (prices must be current).
const V = "sam-v1";
const SHELL = ["/", "/index.html", "/common.css", "/app.css", "/common.js", "/app.js", "/fonts/vazirmatn-4.woff2", "/fonts/vazirmatn-5.woff2", "/icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/admin")) return;
  // network first, so a new version shows up at once; cache when offline
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("/index.html"))));
});
