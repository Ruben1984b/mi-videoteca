const { requireAdmin } = require('./_auth');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36';
const clean = (t) =>
  String(t || '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'")
    .replace(/\[[^\]]*\]|\([^)]*(?:HD|latino|castellano|español|completa)[^)]*\)/gi, ' ')
    .replace(/\b(pel[ií]cula completa|completa|full hd|hd|1080p|720p|espa[ñn]ol|latino|castellano|online|gratis)\b/gi, ' ')
    .replace(/[|•–—-]+\s*(ok\.ru|odnoklassniki|youtube).*$/i, ' ')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')  // "Scream 5 ( 2022 )" → "Scream 5 (2022)\"
    .replace(/\s+/g, ' ')
    .trim();

// Lee el título de un enlace (YouTube por oEmbed, el resto por og:title) para autocompletar el alta
module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const u = new URL(String(req.query.url || ''));
    if (!/^https?:$/.test(u.protocol)) throw new Error('URL inválida');
    // TokyVideo: la página no se puede reproducir en un iframe; hay que usar /{idioma}/embed/ID.
    // El ID sale de las rutas de la carátula y el idioma debe ser el del vídeo: con otro idioma responde "no existe".
    // Cada candidato se comprueba: el embed válido tiene "Embed:" en el título de la página.
    if (/(^|\.)tokyvideo\.com$/.test(u.hostname) && /\/video\//.test(u.pathname)) {
      const headers = { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' };
      const r = await fetch(u, { headers, signal: AbortSignal.timeout(7000) });
      const html = await r.text();
      const id = (html.match(/\/videos\/\d+\/(\d+)\//) || [])[1];
      const t = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || [])[1] || '';
      let embed = '';
      if (id) {
        const first = (u.pathname.match(/^\/(\w\w)\//) || [])[1];
        for (const lang of [...new Set([first, 'es', 'fr', 'en'].filter(Boolean))]) {
          const candidate = `https://www.tokyvideo.com/${lang}/embed/${id}`;
          const page = await fetch(candidate, { headers, signal: AbortSignal.timeout(4000) }).then((x) => x.text()).catch(() => '');
          if (/<title>[^<]*Embed:/i.test(page)) { embed = candidate; break; }
        }
      }
      return res.status(200).json({ title: clean(t), embed });
    }
    let title = '';
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(u.href), { signal: AbortSignal.timeout(7000) });
      if (r.ok) title = (await r.json()).title || '';
    } else {
      const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' }, signal: AbortSignal.timeout(7000) });
      title = ((await r.text()).match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || [])[1] || '';
    }
    res.status(200).json({ title: clean(title) });
  } catch (e) {
    res.status(200).json({ title: '', error: e.message });
  }
};
