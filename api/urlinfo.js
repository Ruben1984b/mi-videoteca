const { requireAdmin } = require('./_auth');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36';
const clean = (t) =>
  String(t || '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'")
    .replace(/\[[^\]]*\]|\([^)]*(?:HD|latino|castellano|español|completa)[^)]*\)/gi, ' ')
    .replace(/\b(pel[ií]cula completa|completa|full hd|hd|1080p|720p|espa[ñn]ol|latino|castellano|online|gratis)\b/gi, ' ')
    .replace(/[|•–—-]+\s*(ok\.ru|odnoklassniki|youtube).*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Lee el título de un enlace (YouTube por oEmbed, el resto por og:title) para autocompletar el alta
module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const u = new URL(String(req.query.url || ''));
    if (!/^https?:$/.test(u.protocol)) throw new Error('URL inválida');
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
