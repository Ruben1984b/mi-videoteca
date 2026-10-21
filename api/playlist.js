const { requireAdmin } = require('./_auth');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36';

// Recorre el JSON de la página y recoge los vídeos de la lista
function walk(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.playlistVideoRenderer) {
    const v = node.playlistVideoRenderer;
    const title = (v.title && (v.title.simpleText || (v.title.runs || []).map((r) => r.text).join(''))) || '';
    if (v.videoId && v.isPlayable !== false) out.push({ title, url: `https://www.youtube.com/watch?v=${v.videoId}` });
    return;
  }
  for (const k in node) walk(node[k], out);
}

// Vía 1 (opcional): API oficial de YouTube, si existe la variable YOUTUBE_API_KEY
async function viaApi(id, key) {
  const items = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ part: 'snippet', maxResults: '50', playlistId: id, key, ...(pageToken && { pageToken }) });
    const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?' + qs, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('YouTube API ' + r.status);
    const d = await r.json();
    for (const it of d.items || []) {
      const s = it.snippet || {};
      if (s.resourceId && s.resourceId.videoId && !/^(Private|Deleted) video$/i.test(s.title || '')) {
        items.push({ title: s.title, url: `https://www.youtube.com/watch?v=${s.resourceId.videoId}` });
      }
    }
    pageToken = d.nextPageToken || '';
  } while (pageToken && items.length < 300);
  return items;
}

// Vía 2 (sin configuración): lee la página pública de la lista. Cubre hasta ~100 vídeos.
async function viaScrape(id) {
  const r = await fetch(`https://www.youtube.com/playlist?list=${id}&hl=es`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
    signal: AbortSignal.timeout(8000)
  });
  const html = await r.text();
  const m = html.match(/ytInitialData\s*=\s*({.+?});\s*<\/script>/s);
  if (!m) throw new Error('YouTube no devolvió la lista (¿pantalla de consentimiento o bloqueo?)');
  const out = [];
  walk(JSON.parse(m[1]), out);
  return out;
}

module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = (String(req.query.url || '').match(/[?&]list=([\w-]+)/) || [])[1];
    if (!id) return res.status(400).json({ error: 'No es una lista de YouTube' });

    let items = [];
    const key = process.env.YOUTUBE_API_KEY;
    if (key) {
      try { items = await viaApi(id, key); } catch (e) { console.error('playlist (API):', e.message); }
    }
    if (!items.length) items = await viaScrape(id);

    const seen = new Set();
    items = items.filter((i) => !seen.has(i.url) && seen.add(i.url));
    res.status(200).json({ id, items });
  } catch (e) {
    console.error('playlist:', e.message);
    res.status(200).json({ items: [], error: e.message });
  }
};
