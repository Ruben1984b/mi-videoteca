// Utilidades HTTP compartidas: lectura acotada de body y comparación en tiempo constante.
const crypto = require('crypto');

// Lee solo los primeros bytes de la respuesta (protege frente a bodies gigantes).
async function readFirstBytes(response, maxBytes = 200_000) {
  if (!response || !response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      out += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(out)) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* ya cerrado */ }
  }
  return out;
}

// Comparación de strings en tiempo constante (para secretos).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = { readFirstBytes, safeEqual };