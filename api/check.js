const { requireAdmin } = require('./_auth');
const { isAllowedHost } = require('./_hosts');
const { readFirstBytes } = require('./_http');

// Función auxiliar para buscar una alternativa en OK.RU
async function findOkRuAlternative(title) {
  if (!title) return null;
  try {
    // Buscamos en el buscador público de OK.RU
    const searchUrl = `https://ok.ru/video/search?query=${encodeURIComponent(title)}`;
    const r = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36' },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return null;
    
    const html = await readFirstBytes(r, 500_000);
    // Buscamos el primer ID de vídeo que aparezca en los resultados
    const match = html.match(/\/video\/(\d+)/);
    if (match && match[1]) {
      return `https://ok.ru/video/${match[1]}`;
    }
  } catch (e) {
    console.warn('Error buscando alternativa OK.RU:', e.message);
  }
  return null;
}

module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const url = String(req.query.url || '').trim();
  const movieId = String(req.query.id || '').trim();
  const title = String(req.query.title || '').trim(); // Nuevo parámetro
  
  let u;
  try {
    u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    if (!isAllowedHost(u.hostname)) return res.status(200).json({ ok: false, reason: 'Dominio no soportado' });
  } catch {
    return res.status(200).json({ ok: false, reason: 'URL inválida' });
  }

  let result = { ok: false, reason: 'Sin respuesta' };
  
  try {
    const isYt = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname);
    const target = isYt ? 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url) : url;

    const r = await fetch(target, {
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9'
      },
    });
    
    if (r.status >= 400) {
      result = { ok: false, reason: 'HTTP ' + r.status };
    } else if (/(^|\.)ok\.ru$/.test(u.hostname)) {
      const body = await readFirstBytes(r, 300_000);
      
      // MEJORA: Si el og:title existe y no está vacío, el vídeo sigue vivo
      const hasOgTitle = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.test(body);
      
      if (!hasOgTitle || /заблокирован|удал[её]н|удалено/i.test(body)) {
        result = { ok: false, reason: 'Vídeo eliminado o bloqueado' };
        // Intentar buscar una alternativa
        if (title) {
          const alt = await findOkRuAlternative(title);
          if (alt) result.alternative = alt;
        }
      } else {
        result = { ok: true };
      }
    } else {
      result = { ok: true };
    }
  } catch (e) {
    const reason = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'Tiempo agotado' : 'Sin respuesta';
    result = { ok: false, reason };
    // Si falló por timeout, también intentamos buscar alternativa si es OK.RU
    if (/(^|\.)ok\.ru$/.test(u.hostname) && title) {
        const alt = await findOkRuAlternative(title);
        if (alt) result.alternative = alt;
    }
  }

  // Guardar en Firestore si nos pasan el ID de la película
  if (movieId) {
    try {
      const updateData = {
        broken: !result.ok,
        lastCheck: admin.firestore.FieldValue.serverTimestamp()
      };
      // Si encontramos alternativa, la guardamos como sugerencia
      if (result.alternative) {
        updateData.suggestedUrl = result.alternative;
      }
      
      await admin.firestore().collection('movies').doc(movieId).update(updateData);
    } catch (e) {
      console.error('Error actualizando estado check:', e);
    }
  }

  res.status(200).json(result);
};