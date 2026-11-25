const { requireAdmin } = require('./_auth');
const { admin } = require('./_firebase');

module.exports = async (req, res) => {
  // 1. RUTA INTEGRADA: Comprobar si el usuario es admin (antes era api/me.js)
  if (req.method === 'GET' && req.query.action === 'me') {
    const authHeader = String(req.headers.authorization || '');
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = m ? m[1].trim() : '';
    if (!token) return res.status(200).json({ isAdmin: false });
    
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      const expected = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
      const isAdmin = (decoded.email || '').toLowerCase() === expected;
      return res.status(200).json({ isAdmin });
    } catch (e) {
      return res.status(200).json({ isAdmin: false });
    }
  }

  // 2. A partir de aquí, todo requiere ser Admin
  if (!(await requireAdmin(req, res))) return;

  try {
    if (req.method === 'GET') {
      const listUsersResult = await admin.auth().listUsers(100);
      const users = listUsersResult.users.map((userRecord) => ({
        uid: userRecord.uid,
        email: userRecord.email,
        disabled: userRecord.disabled,
        lastSignIn: userRecord.metadata.lastSignInTime
      }));
      return res.status(200).json({ users });
    }

    if (req.method === 'POST') {
      const { email, password } = req.body || {};
      if (!email || !password || password.length < 6) {
        return res.status(400).json({ error: 'Email y contraseña (mín. 6 caracteres) son obligatorios' });
      }
      const userRecord = await admin.auth().createUser({ email, password });
      return res.status(200).json({ uid: userRecord.uid, email: userRecord.email });
    }

    if (req.method === 'DELETE') {
      const { uid } = req.query;
      if (!uid) return res.status(400).json({ error: 'Falta uid' });
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const decoded = await admin.auth().verifyIdToken(token);
      if (uid === decoded.uid) return res.status(400).json({ error: 'No puedes revocar tu propio acceso' });
      await admin.auth().updateUser(uid, { disabled: true });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('users:', e.message);
    if (e.code === 'auth/email-already-exists') {
      return res.status(400).json({ error: 'Ese correo ya está registrado' });
    }
    res.status(500).json({ error: 'Error interno al gestionar usuarios' });
  }
};
