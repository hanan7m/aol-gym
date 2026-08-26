// =========================================================
// Service Worker — AOL GYM
// يخزن ملفات التطبيق محلياً على جهاز المستخدم بعد أول زيارة،
// بحيث يفتح التطبيق فوراً وحتى بدون إنترنت (أو باتصال ضعيف).
// =========================================================

const CACHE_NAME = 'aol-gym-v9';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css?v=7',
  './icons.js',
  './logo.js',
  './data.js',
  './supabase-client.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// عند التثبيت: تنزيل وتخزين الملفات الأساسية للتطبيق
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

// عند التفعيل: حذف أي نسخ كاش قديمة من إصدارات سابقة
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// استراتيجية: Cache First مع تحديث في الخلفية (Stale-While-Revalidate)
// يعرض النسخة المخزنة فوراً، وبنفس الوقت يحاول جلب نسخة أحدث من الشبكة لتحديث الكاش
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached); // بدون إنترنت: استخدم النسخة المخزنة إن وجدت

      return cached || network;
    })
  );
});
