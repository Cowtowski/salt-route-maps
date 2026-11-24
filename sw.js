// Salt Route Maps: offline support.
const V = "rm-v1", DATA = "rm-data-v1", TILES = "rm-tiles-v1", LIBS = "rm-libs-v1";
const LIB_URLS = ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js"];
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const d = await caches.open(DATA); await d.addAll(["./", "manifest.webmanifest", "icon-192.png"]).catch(() => {});
    const l = await caches.open(LIBS); await Promise.all(LIB_URLS.map(u => fetch(u, {mode: "cors"}).then(r => r.ok && l.put(u, r)).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![DATA, TILES, LIBS].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});
let puts = 0;
async function trimTiles(){
  const c = await caches.open(TILES), keys = await c.keys();
  if (keys.length > 6000) for (const k of keys.slice(0, keys.length - 5000)) await c.delete(k);
}
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  // App, routes and codes file: newest when online, saved copy when offline
  if (url.origin === location.origin){
    e.respondWith((async () => {
      const c = await caches.open(DATA);
      try { const r = await fetch(req, {cache: "no-cache"}); if (r.ok) c.put(req, r.clone()); return r; }
      catch(err){ return (await c.match(req, {ignoreSearch: true})) || (req.mode === "navigate" && await c.match("./")) || Response.error(); }
    })());
    return;
  }
  if (LIB_URLS.includes(req.url)){
    e.respondWith(caches.open(LIBS).then(async c => (await c.match(req.url)) || fetch(req).then(r => { if (r.ok) c.put(req.url, r.clone()); return r; })));
    return;
  }
  // Map tiles: saved copy first, then network (and save it)
  if (url.hostname === "server.arcgisonline.com" && url.pathname.includes("/tile/")){
    e.respondWith((async () => {
      const c = await caches.open(TILES), hit = await c.match(req.url);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === "opaque"){ c.put(req.url, r.clone()); if (++puts % 200 === 0) trimTiles(); } return r; }
      catch(err){ return Response.error(); }
    })());
  }
});
