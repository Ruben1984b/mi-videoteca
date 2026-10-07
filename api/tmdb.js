const { requireAdmin } = require('./_auth');

async function tmdb(path, params = {}) {
  const qs = new URLSearchParams({ api_key: process.env.TMDB_API_KEY, language: 'es-ES', ...params });
  const r = await fetch(`https://api.themoviedb.org/3${path}?${qs}`);
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const toCand = (r, type) => ({
  id: r.id,
  type,
  title: r.title || r.name,
  original: r.original_title || r.original_name,
  year: (r.release_date || r.first_air_date || '').slice(0, 4),
  lang: r.original_language,
  overview: (r.overview || '').slice(0, 140),
  poster: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : '',
  pop: r.popularity || 0
});

// Candidatos ordenados: título exacto > año > idioma español (si se pide) > popularidad.
// Acepta también un enlace de TMDB o un ID de IMDb (tt...) para una coincidencia exacta.
async function candidates({ title, category, year, es }) {
  const ref = String(title || '');
  let m = ref.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  if (m) return [toCand(await tmdb(`/${m[1]}/${m[2]}`), m[1])];
  m = ref.match(/\b(tt\d{6,})\b/);
  if (m) {
    const f = await tmdb(`/find/${m[1]}`, { external_source: 'imdb_id' });
    return [...(f.movie_results || []).map((r) => toCand(r, 'movie')), ...(f.tv_results || []).map((r) => toCand(r, 'tv'))];
  }
  const type = category === 'Serie' ? 'tv' : 'movie';
  const yearParam = year ? (type === 'tv' ? { first_air_date_year: year } : { year }) : {};
  const data = await tmdb(`/search/${type}`, { query: ref, ...yearParam });
  const q = norm(ref);
  return (data.results || [])
    .map((r) => toCand(r, type))
    .map((c) => ({
      ...c,
      score:
        (norm(c.title) === q || norm(c.original) === q ? 3 : 0) +
        (year && c.year === String(year) ? 3 : 0) +
        (es && c.lang === 'es' ? 2 : 0) +
        Math.min(c.pop, 100) / 100
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

async function details(type, id) {
  const tv = type === 'tv';
  const d = await tmdb(`/${type}/${id}`, { append_to_response: tv ? 'credits,content_ratings' : 'credits,release_dates' });
  const director = tv
    ? (d.created_by || []).map((c) => c.name).join(', ')
    : ((d.credits?.crew || []).find((c) => c.job === 'Director') || {}).name;
  const es = (list) => (list || []).find((r) => r.iso_3166_1 === 'ES');
  const ageRating = tv
    ? es(d.content_ratings?.results)?.rating || ''
    : (es(d.release_dates?.results)?.release_dates || []).map((x) => x.certification).find(Boolean) || '';
  return {
    tmdbId: d.id,
    poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '',
    overview: d.overview || '',
    year: (d.release_date || d.first_air_date || '').slice(0, 4),
    director: director || 'Desconocido',
    genres: (d.genres || []).slice(0, 2).map((g) => g.name),
    cast: (d.credits?.cast || []).slice(0, 5).map((c) => c.name),
    ageRating
  };
}

module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { mode, title, category, year, es, id, type } = req.query;
  try {
    if (mode === 'details') {
      if (!/^\d+$/.test(id || '') || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'Parámetros inválidos' });
      return res.status(200).json(await details(type, id));
    }
    if (!title) return res.status(400).json({ error: 'Falta title' });
    const list = await candidates({ title, category, year, es });
    if (mode === 'candidates') return res.status(200).json(list);
    // Sin modo (carga masiva): se usa la mejor candidata
    if (!list.length) return res.status(200).json({});
    res.status(200).json(await details(list[0].type, list[0].id));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
