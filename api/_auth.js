const { admin } = require('./_firebase');

// Solo deja pasar al administrador (token de Firebase Auth + correo igual a ADMIN_EMAIL).
// Si falla, deja el motivo exacto en los logs de Vercel (sin mostrar correos ni claves).
async function requireAdmin(req, res) {
  const expected = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  try {
    if (!expected) throw new Error('ADMIN_EMAIL no está definida en Vercel (o falta redesplegar tras añadirla)');
    const authHeader = String(req.headers.authorization || '');
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = m ? m[1].trim() : '';
    if (!token) throw new Error('La petición no lleva el token de sesión');
    const decoded = await admin.auth().verifyIdToken(token);
    if ((decoded.email || '').toLowerCase() !== expected) throw new Error('El correo de la sesión no coincide con ADMIN_EMAIL');
    return true;
  } catch (e) {
    console.error('requireAdmin:', e.message);
    res.status(401).json({ error: 'No autorizado' });
    return false;
  }
}

module.exports = { requireAdmin };