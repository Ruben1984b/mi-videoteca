const { admin } = require('./_firebase');
const crypto = require('crypto');

async function tmdb(path, params = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('TMDB_API_KEY no está definida en Vercel');

  const qs = new URLSearchParams({ api_key: apiKey, language: 'es-ES', ...params });
  const url = `https://api.themoviedb.org/3${path}?${qs}`;

  // 1. Comprobar si está en caché (Firestore)
  const hash = crypto.createHash('md5').update(url).digest('hex');
  const cacheRef = admin.firestore().collection('tmdbCache').doc(hash);

  try {
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const data = cacheSnap.data();
      // TTL de 7 días (604800000 ms)
      if (Date.now() - data.timestamp < 604800000) {
        return JSON.parse(data.response);
      }
    }
  } catch (e) {
    console.warn('Error leyendo caché TMDB:', e.message);
  }

  // 2. Si no está en caché, llamar a TMDB
  const r = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'CineStream/1.0' },
  });
  if (!r.ok) throw new Error('TMDB ' + r.status);
  const data = await r.json();

  // 3. Guardar en caché (no bloqueante)
  cacheRef.set({ response: JSON.stringify(data), timestamp: Date.now() }).catch(e => console.warn('Error guardando caché:', e));

  return data;
}

module.exports = { tmdb };