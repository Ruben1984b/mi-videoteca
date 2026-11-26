const CACHE = 'cinestream-v2'; // Nueva versión para forzar la actualización
const ASSETS = ['/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e => {
  self.skipWaiting(); // Forzar activación inmediata
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  // Limpiar cachés antiguos
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => k !== CACHE && caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  
  // No interceptar Firebase, APIs de TMDB ni YouTube
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis') || url.hostname.includes('tmdb.org') || url.hostname.includes('youtube.com')) return;
  
  // Network First para HTML (así siempre coges los últimos cambios)
  if (e.request.mode === 'navigate' || (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html'))) {
    e.respondWith(
      fetch(e.request).then(res => {
        const resClone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, resClone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache First para el resto (imágenes, etc.)
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      return caches.open(CACHE).then(c => {
        if (e.request.method === 'GET' && res.status === 200) c.put(e.request, res.clone());
        return res;
      });
    }))
  );
});