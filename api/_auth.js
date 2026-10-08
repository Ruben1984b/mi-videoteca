const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

// Solo deja pasar al administrador (token de Firebase Auth + correo igual a ADMIN_EMAIL).
// El prefijo "_" hace que Vercel NO exponga este archivo como endpoint.
// Si falla, deja el motivo exacto en los logs de Vercel (sin mostrar correos ni claves).
async function requireAdmin(req, res) {
  const expected = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  try {
    if (!expected) throw new Error('ADMIN_EMAIL no está definida en Vercel (o falta redesplegar tras añadirla)');
    const token = (req.headers.authorization || '').replace('Bearer ', '');
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
