const { requireAdmin } = require('./_auth');

module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const url = String(req.query.url || '').trim();
  let u;
  try {
    u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    return res.status(200).json({ ok: false, reason: 'URL inválida' });
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    // YouTube devuelve 4xx en oEmbed si el vídeo es privado o fue eliminado
    const isYt = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname);
    const target = isYt ? 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url) : url;

    const r = await fetch(target, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36' }
    });
    if (r.status >= 400) return res.status(200).json({ ok: false, reason: 'HTTP ' + r.status });

    // OK.RU responde 200 aunque el vídeo esté eliminado: heurística por texto (puede fallar)
    if (/(^|\.)ok\.ru$/.test(u.hostname)) {
      const body = (await r.text()).slice(0, 300000);
      if (/заблокирован|удал[её]н|удалено/i.test(body)) {
        return res.status(200).json({ ok: false, reason: 'Vídeo eliminado o bloqueado' });
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false, reason: e.name === 'AbortError' ? 'Tiempo agotado' : 'Sin respuesta' });
  } finally {
    clearTimeout(timer);
  }
};
