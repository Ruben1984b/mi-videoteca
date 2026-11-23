const { admin } = require('./_firebase');

// Endpoint público y mínimo: marca un título como "enlace caído" y te avisa por Telegram con un botón para reponerlo.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const id = String((req.body && req.body.id) || '');
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const ref = admin.firestore().collection('movies').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'No existe' });
    const data = snap.data();
    const first = !data.broken; // solo avisa la primera vez (evita spam)
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