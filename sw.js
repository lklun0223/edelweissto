const CACHE = 'workie-nextgen-shell-d4473e88df79e1dd';
const SHELL_PATHS = [
  "index.html",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "nextgen/allocation-view.mjs",
  "nextgen/backup-merge.mjs",
  "nextgen/budget-plans.mjs",
  "nextgen/budget-transfer.mjs",
  "nextgen/calendar-export.js",
  "nextgen/chart-4.4.9.js",
  "nextgen/cormorant-garamond.ttf",
  "nextgen/coverage.mjs",
  "nextgen/csv.mjs",
  "nextgen/editorial.css",
  "nextgen/expense-analytics.js",
  "nextgen/folio.css",
  "nextgen/i18n.mjs",
  "nextgen/inter-variable.woff2",
  "nextgen/interaction.css",
  "nextgen/interaction.mjs",
  "nextgen/journey-options.mjs",
  "nextgen/ledger.mjs",
  "nextgen/legacy-vault.mjs",
  "nextgen/legacy-work.mjs",
  "nextgen/lesson-time.mjs",
  "nextgen/lucide-1.8.0.js",
  "nextgen/presentation.css",
  "nextgen/presentation.mjs",
  "nextgen/product-finance.mjs",
  "nextgen/product.css",
  "nextgen/rates.mjs",
  "nextgen/refinement.css",
  "nextgen/repository.mjs",
  "nextgen/tailwind-3.4.17.js",
  "nextgen/weekly-settlement.css",
  "nextgen/weekly-settlement.mjs",
  "nextgen/work-analytics.mjs",
  "nextgen/work-data.mjs",
  "nextgen/work-receipts.mjs",
  "nextgen/workspace.css",
  "nextgen/workspace.mjs",
  "nextgen/wtp-expenses.mjs",
  "nextgen/wtp-prompt.mjs",
  "nextgen/wtp.mjs"
];
const url = path => new URL(path, self.registration.scope).href;
const shell = new Set(SHELL_PATHS.map(url));
const cachePrefix = 'workie-nextgen-shell:' + encodeURIComponent(new URL(self.registration.scope).pathname) + ':';
const cacheName = cachePrefix + CACHE;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll(SHELL_PATHS.map(path => new Request(url(path), {cache: 'reload'})))));
  // Wait for older tabs unless the only Workie tab explicitly requests the update.
});
self.addEventListener('message', event => {
  if(event.data!=='workie-install-update'||!event.ports[0]||event.source?.type!=='window')return;
  event.waitUntil((async()=>{
    const tabs=(await self.clients.matchAll({type:'window',includeUncontrolled:true}))
      .filter(client=>client.url.startsWith(self.registration.scope));
    if(tabs.length!==1||tabs[0].id!==event.source.id) {
      event.ports[0].postMessage('other-tabs');
      return;
    }
    event.ports[0].postMessage('installing');
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== cacheName && key.startsWith(cachePrefix))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const href = event.request.url;
  const address = new URL(href);
  const root = new URL(self.registration.scope);
  const appEntry = event.request.mode === 'navigate' && address.origin === root.origin &&
    [root.pathname, new URL('index.html', root).pathname].includes(address.pathname);
  if (!appEntry && !shell.has(href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(appEntry ? url('index.html') : href) ?? fetch(event.request);
  })());
});
