const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

// Solo deja pasar al administrador (token de Firebase Auth + correo igual a ADMIN_EMAIL).
// El prefijo "_" hace que Vercel NO exponga este archivo como endpoint.
async function requireAdmin(req, res) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const decoded = await admin.auth().verifyIdToken(token);
    if (!process.env.ADMIN_EMAIL || decoded.email !== process.env.ADMIN_EMAIL) throw new Error('forbidden');
    return true;
  } catch {
    res.status(401).json({ error: 'No autorizado' });
    return false;
  }
}

module.exports = { requireAdmin };
