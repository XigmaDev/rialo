/*
  Service Worker — ریالو
  استراتژی: Stale-While-Revalidate برای App Shell.
    - پاسخ همیشه فوراً از کش داده می‌شود (اجرای کاملاً آفلاین و سریع)،
    - هم‌زمان نسخه‌ی تازه از شبکه گرفته و در کش جایگزین می‌شود، پس هر به‌روزرسانی
      روی GitHub Pages حداکثر در اجرای بعدی به دست کاربر می‌رسد.
  (نسخه‌ی قبلی Cache-First با نسخه‌ی ثابت بود و کاربران هرگز به‌روزرسانی را نمی‌گرفتند.)
  هیچ درخواست شبکه‌ای به بیرون (API خارجی) در این پروژه وجود ندارد.
*/

const CACHE_VERSION = 'rialo-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/smsParser.js',
  './js/charts.js',
  './js/seed.js',
  './js/xlsxExport.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// نصب: پیش‌ذخیره‌سازی کامل پوسته برنامه (با دور زدن کش HTTP مرورگر)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// فعال‌سازی: پاک‌سازی نسخه‌های قدیمی کش
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // فقط فایل‌های خود برنامه

  const isNavigation = req.mode === 'navigate';
  // همه‌ی ناوبری‌ها (هر hash/query) همان index.html هستند
  const cacheKey = isNavigation ? './index.html' : req;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(cacheKey, { ignoreSearch: isNavigation });

    const network = fetch(req).then((res) => {
      // فقط پاسخ‌های سالم کش می‌شوند (نه 404/500 یا پاسخ‌های opaque)
      if (res && res.ok && res.type === 'basic') cache.put(cacheKey, res.clone());
      return res;
    });

    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    try {
      return await network;
    } catch (e) {
      if (isNavigation) {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
