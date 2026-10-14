// 오프라인 안내 전용입니다. 화면(페이지 이동)이 네트워크로 열리지 않을 때만 안내 화면을 보여 줍니다.
// /api 요청과 로그인 토큰이 오가는 요청은 가로채거나 저장하지 않으므로 서버의 허용·거부 결과가 그대로 유지됩니다.
const OFFLINE_CACHE = 'offline-notice-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== OFFLINE_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  if (new URL(request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
});
