// ✅ 建議：改一改 version 名，之後每次大更新先手動 bump（例如 v3、v4）
const CACHE_NAME = 'workie-v2';

// 仍然預先 cache 圖標等 static asset（唔再硬性 cache index.html）
const ASSETS = [
  './',
  './icon-192.png',
  './icon-512.png'
];

// 安裝：cache static 資源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 啟用：清舊版本 cache
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// 取用策略：
// - HTML（頁面）→ network-first（確保有新版本）
// - 其他靜態資源（icon / css / js 等）→ cache-first
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Frankfurter API：完全唔攔，交返俾瀏覽器處理
  if (url.origin === 'https://api.frankfurter.app' ||
      url.origin === 'https://api.frankfurter.dev') {
    return;
  }

  // 2. 只處理同源請求（你自己 site 的資源）
  if (url.origin !== self.location.origin) {
    return;
  }

  // 2a. 如果係 HTML 頁面（尤其 index.html / navigation）
  if (request.mode === 'navigate' ||
      (request.destination === 'document')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // 成功從網絡攞到，就順便更新 cache
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => {
          // 如果 offline / 網絡失敗，就退而求其次用 cache 版本
          return caches.match(request).then(cached => {
            // 未必一定有 cache，如果冇就簡單回傳預設 offline 回應
            if (cached) return cached;
            // 可以揀：拋錯 / 回傳簡單 fallback
            return new Response(
              '<h1>Offline</h1><p>請重新連線再試一次。</p>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          });
        })
    );
    return;
  }

  // 2b. 其他靜態資源：cache-first（例如 icon、css、js 等）
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      });
    })
  );
});