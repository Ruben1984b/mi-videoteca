const { requireAdmin } = require('./_auth');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36';

const textOf = (t) => (!t ? '' : t.simpleText || t.content || (t.runs || []).map((r) => r.text).join('') || '');

// Recorre el JSON de la página y recoge los vídeos de la lista (formato clásico y formato "lockup" más nuevo)
function walk(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.playlistVideoRenderer) {
    const v = node.playlistVideoRenderer;
    if (v.videoId && v.isPlayable !== false) out.push({ id: v.videoId, title: textOf(v.title) });
    return;
  }
  const l = node.lockupViewModel;
  if (l && /VIDEO/.test(l.contentType || '') && l.contentId) {
    out.push({ id: l.contentId, title: textOf(l.metadata && l.metadata.lockupMetadataViewModel && l.metadata.lockupMetadataViewModel.title) });
    return;
  }
  for (const k in node) walk(node[k], out);
}

// Vía 1 (opcional, la más fiable): API oficial de YouTube con la variable YOUTUBE_API_KEY
async function viaApi(id, key) {
  const items = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ part: 'snippet', maxResults: '50', playlistId: id, key, ...(pageToken && { pageToken }) });
    const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?' + qs, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('API de YouTube: HTTP ' + r.status);
    const d = await r.json();
    for (const it of d.items || []) {
      const s = it.snippet || {};
      if (s.resourceId && s.resourceId.videoId && !/^(Private|Deleted) video$/i.test(s.title || '')) {
        items.push({ id: s.resourceId.videoId, title: s.title || '' });
      }
    }
    pageToken = d.nextPageToken || '';
  } while (pageToken && items.length < 300);
  return items;
}

// Vía 2 (sin configuración): lee la página pública. Si el formato no se reconoce, busca los ID de vídeo en bruto.
async function viaScrape(id) {
  const r = await fetch(`https://www.youtube.com/playlist?list=${id}&hl=es`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000)
  });
  const html = await r.text();
  const info = { status: r.status, bytes: html.length, host: new URL(r.url).hostname, structured: 0, generic: 0 };
  let out = [];
  const m = html.match(/ytInitialData\s*=\s*({.+?});\s*<\/script>/s);
  if (m) {
    try { walk(JSON.parse(m[1]), out); } catch (e) { info.parse = e.message; }
  }
  info.structured = out.length;
  if (!out.length) {
    const ids = [];
    for (const x of html.matchAll(/"videoId":"([\w-]{11})"/g)) if (!ids.includes(x[1])) ids.push(x[1]);
    out = ids.slice(0, 200).map((v) => ({ id: v, title: '' }));
    info.generic = out.length;
  }
  return { items: out, info };
}

// Los títulos que falten se piden a oEmbed (público, sin clave)
async function fillTitles(items) {
  const todo = items.filter((i) => !i.title);
  let n = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (n < todo.length) {
        const it = todo[n++];
        try {
          const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + it.id), { signal: AbortSignal.timeout(4000) });
          if (r.ok) it.title = (await r.json()).title || '';
        } catch { /* se queda sin título */ }
      }
    })
  );
}

module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = (String(req.query.url || '').match(/[?&]list=([\w-]+)/) || [])[1];
    if (!id) return res.status(400).json({ error: 'No es una lista de YouTube' });

    let items = [];
    let info = null;
    const key = process.env.YOUTUBE_API_KEY;
    if (key) {
      try { items = await viaApi(id, key); } catch (e) { console.error('playlist (API):', e.message); }
    }
    if (!items.length) ({ items, info } = await viaScrape(id));

    const seen = new Set();
    items = items.filter((i) => !seen.has(i.id) && seen.add(i.id));
    if (!items.length) {
      console.error('playlist sin vídeos:', JSON.stringify(info));
      const d = info ? ` (HTTP ${info.status}, ${info.bytes} bytes, ${info.host}, reconocidos: ${info.structured}/${info.generic})` : '';
      return res.status(200).json({
        items: [],
        error: `No se encontró ningún vídeo${d}. Puede que YouTube bloquee la lectura desde el servidor o que la lista sea privada; la solución fiable es la API oficial (variable YOUTUBE_API_KEY en Vercel).`
      });
    }
    await fillTitles(items);
    res.status(200).json({
      id,
      items: items.map((i, n) => ({ title: i.title || `Episodio ${n + 1}`, url: `https://www.youtube.com/watch?v=${i.id}` }))
    });
  } catch (e) {
    console.error('playlist:', e.message);
    res.status(200).json({ items: [], error: e.message });
  }
};
