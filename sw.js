// sw.js
// 北方カメラ - PWA キャッシュ

const VERSION = "v1.6.0";
const APP_CACHE = `kitagata-cam-${VERSION}`;

const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./js/app.js",
  "./js/config.js",
  "./js/storage.js",
  "./js/photoStore.js",
  "./js/ui.js",
  "./js/sheets.js",
  "./js/gas-uploader.js",
  "./js/camera.js",
  "./js/composer.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== APP_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;

  // Google API / GAS はキャッシュしない
  if (url.hostname.endsWith("googleapis.com") ||
      url.hostname.endsWith("google.com") ||
      url.hostname === "accounts.google.com" ||
      url.hostname.includes("script.google")) {
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

async function cacheFirst(req) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200 && fresh.type === "basic") {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    if (req.mode === "navigate") {
      const fallback = await cache.match("./index.html");
      if (fallback) return fallback;
    }
    throw e;
  }
}
