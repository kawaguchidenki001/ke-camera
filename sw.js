// sw.js
// シンプルなアプリシェル + ランタイムキャッシュ

const VERSION = "v0.1.0";
const APP_CACHE = `ke-camera-app-${VERSION}`;

// アプリ起動に必要な静的アセット
const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./js/app.js",
  "./js/config.js",
  "./js/storage.js",
  "./js/ui.js",
  "./js/auth.js",
  "./js/sheets.js",
  "./js/drive.js",
  "./js/camera.js",
  "./js/composer.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
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

  // GET 以外はそのまま通す(POST /upload など)
  if (req.method !== "GET") return;

  // Google API への呼び出しはキャッシュしない(認証ヘッダや動的データのため)
  if (url.hostname.endsWith("googleapis.com") ||
      url.hostname.endsWith("google.com") ||
      url.hostname === "accounts.google.com") {
    return;
  }

  // 同一オリジンの静的リソース: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // それ以外: ネットワーク優先 + キャッシュフォールバック
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

async function cacheFirst(req) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    // 200 のみキャッシュ
    if (fresh && fresh.status === 200 && fresh.type === "basic") {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    // ネットワーク失敗時、ナビゲーションリクエストなら index を返す(オフライン起動)
    if (req.mode === "navigate") {
      const fallback = await cache.match("./index.html");
      if (fallback) return fallback;
    }
    throw e;
  }
}
