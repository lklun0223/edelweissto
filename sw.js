const CACHE_NAME = 'workie-v1';
const ASSETS = [
  './index.html',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. 對 Frankfurter API：完全唔攔，交返俾瀏覽器處理（避免 CORS + SW 夾硬 cache）
  if (url.origin === 'https://api.frankfurter.app') {
    return; // 不調用 respondWith
  }

  // 2. 只處理同源請求（你自己 site 的資源）
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request);
      })
    );
  }
  // 3. 其他第三方資源：照樣放過，由瀏覽器自己處理
});