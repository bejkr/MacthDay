// MATCHDAY service worker
// Zámerne jednoduchý a konzervatívny:
//   * statické súbory (JS, CSS, písma, ikony) – cache-first, sú verziované názvom
//   * stránky – vždy zo siete; ak sieť nie je, zobrazí sa offline obrazovka
//   * údaje z databázy sa NEcachujú a zápisy (POST) sa nikdy neodkladajú do fronty,
//     takže offline nevzniknú neaktuálne ani duplicitné zápisy
const VERSION = "matchday-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // zápisy idú vždy priamo na server

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Statické, nemenné súbory
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Navigácia: sieť, pri výpadku offline obrazovka
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || new Response("Offline", { status: 503 })),
    );
  }
});
