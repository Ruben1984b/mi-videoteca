// Cliente único de TMDB con timeout y User-Agent.
// Evita duplicar la función en tmdb.js y bot.js.
async function tmdb(path, params = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('TMDB_API_KEY no está definida en Vercel');
  const qs = new URLSearchParams({ api_key: apiKey, language: 'es-ES', ...params });
  const r = await fetch(`https://api.themoviedb.org/3${path}?${qs}`, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'CineStream/1.0' },
  });
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}

module.exports = { tmdb };