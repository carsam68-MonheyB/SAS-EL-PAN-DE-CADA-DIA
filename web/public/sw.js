// Service worker de la caja: guarda la aplicación (no los datos de la API)
// para que la pantalla de venta abra aunque no haya internet (P43).
const CACHE = "erp-app-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/index.html"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Páginas: primero la red (versión nueva) y, sin conexión, la copia guardada.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put("/index.html", copia)); return r; })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }
  // Archivos de la aplicación (llevan huella en el nombre): primero la copia guardada.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(e.request).then((r) => r ?? fetch(e.request).then((x) => { const copia = x.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return x; })));
  }
});
