// Inicialización única de firebase-admin.
// El prefijo "_" hace que Vercel NO lo exponga como endpoint.
const admin = require('firebase-admin');

if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no está definida en Vercel');
  }
  let credential;
  try {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT mal formada: ' + e.message);
  }
  admin.initializeApp({ credential });
}

module.exports = { admin };