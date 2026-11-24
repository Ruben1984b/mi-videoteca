const { requireAdmin } = require('./_auth');
const { isAllowedHost } = require('./_hosts');
const { readFirstBytes } = require('./_http');

module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const url = String(req.query.url || '').trim();
  let u;
  try {
    u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    if (!isAllowedHost(u.hostname)) return res.status(200).json({ ok: false, reason: 'Dominio no soportado' });
  } catch {
    return res.status(200).json({ ok: false, reason: 'URL inválida' });
  }

  try {
    const isYt = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname);
    const target = isYt ? 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url) : url;

    const r = await fetch(target, {
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36' },
    });
    if (r.status >= 400) return res.status(200).json({ ok: false, reason: 'HTTP ' + r.status });

    if (/(^|\.)ok\.ru$/.test(u.hostname)) {
      const body = await readFirstBytes(r, 300_000);
      if (/заблокирован|удал[её]н|удалено/i.test(body)) {
        return res.status(200).json({ ok: false, reason: 'Vídeo eliminado o bloqueado' });
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    const reason = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'Tiempo agotado' : 'Sin respuesta';
    res.status(200).json({ ok: false, reason });
  }
};