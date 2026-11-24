const { requireAdmin } = require('./_auth');
const { cleanTitle } = require('./_text');
const { isAllowedHost } = require('./_hosts');
const { readFirstBytes } = require('./_http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36';

module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const u = new URL(String(req.query.url || ''));
    if (!/^https?:$/.test(u.protocol)) throw new Error('URL inválida');
    if (!isAllowedHost(u.hostname)) throw new Error('Dominio no permitido');

    // TokyVideo: la página no se puede reproducir en un iframe; hay que usar /{idioma}/embed/ID.
    if (/(^|\.)tokyvideo\.com$/.test(u.hostname) && /\/video\//.test(u.pathname)) {
      const headers = { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' };
      const r = await fetch(u, { headers, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('Respuesta ' + r.status);
      const html = await readFirstBytes(r, 300_000);
      const id = (html.match(/\/videos\/\d+\/(\d+)\//) || [])[1];
      const t = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || [])[1] || '';
      let embed = '';
      if (id) {
        const first = (u.pathname.match(/^\/(\w\w)\//) || [])[1];
        const langs = [...new Set([first, 'es', 'fr', 'en'].filter(Boolean))];
        const results = await Promise.all(langs.map(async (lang) => {
          const candidate = `https://www.tokyvideo.com/${lang}/embed/${id}`;
          try {
            const page = await fetch(candidate, { headers, signal: AbortSignal.timeout(4000) });
            if (!page.ok) return null;
            const body = await readFirstBytes(page, 50_000);
            return /<title>[^<]*Embed:/i.test(body) ? candidate : null;
          } catch { return null; }
        }));
        embed = results.find(Boolean) || '';
      }
      return res.status(200).json({ title: cleanTitle(t), embed });
    }

    let title = '';
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(u.href), { signal: AbortSignal.timeout(7000) });
      if (r.ok) title = (await r.json()).title || '';
    } else {
      const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' }, signal: AbortSignal.timeout(7000) });
      if (!r.ok) throw new Error('Respuesta ' + r.status);
      const html = await readFirstBytes(r, 300_000);
      title =
        (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) || [])[1] ||
        (html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i) || [])[1] ||
        '';
    }
    res.status(200).json({ title: cleanTitle(title) });
  } catch (e) {
    console.error('urlinfo:', e.message);
    res.status(200).json({ title: '', error: e.message });
  }
};