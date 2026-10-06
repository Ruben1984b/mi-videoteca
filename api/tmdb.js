const { requireAdmin } = require('./_auth');

async function tmdb(path, params = {}) {
  const qs = new URLSearchParams({ api_key: process.env.TMDB_API_KEY, language: 'es-ES', ...params });
  const r = await fetch(`https://api.themoviedb.org/3${path}?${qs}`);
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}

module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { title, category, year } = req.query;
  if (!title) return res.status(400).json({ error: 'Falta title' });

  try {
    const tv = category === 'Serie';
    const type = tv ? 'tv' : 'movie';
    const yearParam = year ? (tv ? { first_air_date_year: year } : { year }) : {};
    const found = await tmdb(`/search/${type}`, { query: title, ...yearParam });
    const m = (found.results || [])[0];
    if (!m) return res.status(200).json({});

    const d = await tmdb(`/${type}/${m.id}`, {
      append_to_response: tv ? 'credits,content_ratings' : 'credits,release_dates'
    });

    // En series el "director" real es el creador (created_by), no el crew
    const director = tv
      ? (d.created_by || []).map((c) => c.name).join(', ')
      : ((d.credits?.crew || []).find((c) => c.job === 'Director') || {}).name;

    const es = (list) => (list || []).find((r) => r.iso_3166_1 === 'ES');
    const ageRating = tv
      ? es(d.content_ratings?.results)?.rating || ''
      : (es(d.release_dates?.results)?.release_dates || []).map((x) => x.certification).find(Boolean) || '';

    res.status(200).json({
      poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '',
      overview: d.overview || '',
      year: (d.release_date || d.first_air_date || '').slice(0, 4),
      director: director || 'Desconocido',
      genres: (d.genres || []).slice(0, 2).map((g) => g.name),
      cast: (d.credits?.cast || []).slice(0, 5).map((c) => c.name),
      ageRating
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
