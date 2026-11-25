const { requireAdmin } = require('./_auth');

module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const api = String(req.query.api || '').trim();
  const wd = String(req.query.wd || '').trim();

  if (!api) return res.status(400).json({ error: 'Falta la URL de la API' });

  try {
    // Las APIs de Apple CMS V10 usan ?ac=list (categorías) o ?wd=query (búsqueda)
    const targetUrl = new URL(api);
    if (wd) {
      targetUrl.searchParams.set('wd', wd);
      targetUrl.searchParams.set('ac', 'detail'); // Algunos usan ac=detail para buscar
    } else {
      targetUrl.searchParams.set('ac', 'list');
    }

    const r = await fetch(targetUrl.toString(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('Error del agregador: HTTP ' + r.status);
    
    // Algunos agregadores devuelven JSON, otros texto. Lo parseamos.
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { throw new Error('El agregador no devolvió un JSON válido'); }

    res.status(200).json(data);
  } catch (e) {
    console.error('aggregator:', e.message);
    res.status(500).json({ error: e.message });
  }
};