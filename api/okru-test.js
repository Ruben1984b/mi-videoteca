const { requireAdmin } = require('./_auth');

// Prueba de viabilidad: ¿puede Vercel leer páginas de OK.RU? Devuelve código HTTP, tamaño e IDs de vídeo hallados.
module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const u = new URL(String(req.query.url || ''));
    if (!/(^|\.)ok\.ru$/.test(u.hostname)) return res.status(400).json({ error: 'Solo URLs de ok.ru' });
    const r = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9'
      },
      signal: AbortSignal.timeout(8000)
    });
    const html = await r.text();
    const ids = new Set([...html.matchAll(/\/video\/(\d{6,})/g)].map((m) => m[1]));
    const title = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || [])[1] || '';
    res.status(200).json({ status: r.status, bytes: html.length, videoIds: ids.size, title });
  } catch (e) {
    res.status(200).json({ status: 0, bytes: 0, videoIds: 0, title: '', error: e.message });
  }
};
