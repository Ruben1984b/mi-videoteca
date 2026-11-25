const CACHE = 'cinestream-v1';
const ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // No cachear Firebase, APIs de TMDB ni YouTube (siempre red)
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis') || url.hostname.includes('tmdb.org') || url.hostname.includes('youtube.com')) return;
  
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      return caches.open(CACHE).then(c => {
        if (e.request.method === 'GET' && res.status === 200) c.put(e.request, res.clone());
        return res;
      });
    }))
  );
});