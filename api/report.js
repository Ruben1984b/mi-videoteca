const { admin } = require('./_firebase');

const MAX_REPORTS = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hora

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  
  const id = String((req.body && req.body.id) || '');
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return res.status(400).json({ error: 'id inválido' });

  // 1. Obtener IP (Vercel pone la IP real en x-forwarded-for)
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rateLimitRef = admin.firestore().collection('rateLimits').doc(ip);
  
  try {
    // 2. Comprobar límite con transacción
    const allowed = await admin.firestore().runTransaction(async (t) => {
      const doc = await t.get(rateLimitRef);
      const now = Date.now();
      
      if (!doc.exists) {
        t.set(rateLimitRef, { count: 1, resetAt: now + WINDOW_MS });
        return true;
      }
      
      const data = doc.data();
      if (now > data.resetAt) {
        // Ventana expirada: reiniciar
        t.set(rateLimitRef, { count: 1, resetAt: now + WINDOW_MS });
        return true;
      }
      
      if (data.count >= MAX_REPORTS) {
        return false; // Bloqueado
      }
      
      // Incrementar contador
      t.update(rateLimitRef, { count: admin.firestore.FieldValue.increment(1) });
      return true;
    });

    if (!allowed) {
      return res.status(429).json({ error: 'Demasiados reportes. Inténtalo más tarde.' });
    }
  } catch (e) {
    console.error('rateLimit:', e.message);
    // Si falla el rate limit, permitimos el reporte para no bloquear la app por un fallo interno
  }

  // 3. Procesar el reporte
  try {
    const ref = admin.firestore().collection('movies').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'No existe' });
    const data = snap.data();
    const first = !data.broken; 
    
    await ref.update({
      broken: true,
      reportedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const { TELEGRAM_BOT_TOKEN: token, MY_CHAT_ID: chat } = process.env;
    if (first && token && chat) {
      const text = `🚩 Enlace caído: ${String(data.title || '').slice(0, 200)}`;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text,
          reply_markup: { inline_keyboard: [[{ text: '🔗 Reponer enlace', callback_data: 'fix:' + id }]] },
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('report:', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
};