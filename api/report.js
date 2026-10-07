require('./_auth'); // inicializa firebase-admin con la variable FIREBASE_SERVICE_ACCOUNT ya existente
const admin = require('firebase-admin');

// Endpoint público y mínimo: solo marca un título como "enlace caído" para revisarlo en el admin.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const id = String((req.body && req.body.id) || '');
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const ref = admin.firestore().collection('movies').doc(id);
    if (!(await ref.get()).exists) return res.status(404).json({ error: 'No existe' });
    await ref.update({ broken: true, reportedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error interno' });
  }
};
