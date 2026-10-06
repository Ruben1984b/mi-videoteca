const admin = require('firebase-admin');

const {
  TMDB_API_KEY,
  TELEGRAM_BOT_TOKEN,
  MY_CHAT_ID,
  TELEGRAM_WEBHOOK_SECRET,
  FIREBASE_SERVICE_ACCOUNT
} = process.env;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = admin.firestore();

// El estado del diálogo vive en Firestore: en Vercel la memoria no persiste entre invocaciones
const stateRef = (chatId) => db.collection('botState').doc(String(chatId));

// ---------- Telegram ----------
const tg = (method, body) =>
  fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

// Sin parse_mode a propósito: un título con _ * [ rompe el Markdown y Telegram rechaza el mensaje
const sendMessage = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, ...extra });
const sendPhoto = (chat_id, photo, caption) => tg('sendPhoto', { chat_id, photo, caption });

// ---------- TMDB ----------
async function tmdb(path, params = {}) {
  const qs = new URLSearchParams({ api_key: TMDB_API_KEY, language: 'es-ES', ...params });
  const res = await fetch(`https://api.themoviedb.org/3${path}?${qs}`);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

function isValidUrl(text) {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------- Flujo ----------
async function searchTitles(chatId, query) {
  const data = await tmdb('/search/multi', { query });
  const results = (data.results || [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv') // descarta personas
    .slice(0, 5);

  if (!results.length) {
    return sendMessage(chatId, '❌ No encontré ninguna película o serie. Prueba con el título original o el nombre exacto.');
  }

  const keyboard = results.map((r) => {
    const title = r.title || r.name;
    const year = (r.release_date || r.first_air_date || '').slice(0, 4) || 's/f';
    const icon = r.media_type === 'tv' ? '📺' : '🎬';
    return [{ text: `${icon} ${title} (${year})`.slice(0, 60), callback_data: `pick:${r.media_type}:${r.id}` }];
  });

  return sendMessage(chatId, 'Elige el título correcto:', { reply_markup: { inline_keyboard: keyboard } });
}

async function pickTitle(chatId, mediaType, id) {
  const d = await tmdb(`/${mediaType}/${id}`, { append_to_response: 'credits' });
  const isTv = mediaType === 'tv';

  // En series el "director" real está en created_by, no en el crew
  const director = isTv
    ? (d.created_by || []).map((c) => c.name).join(', ')
    : (d.credits?.crew || []).find((c) => c.job === 'Director')?.name || '';

  // Mismo esquema que usa admin.html, para que index.html lo pinte igual
  const movie = {
    title: isTv ? d.name : d.title,
    category: isTv ? 'Serie' : 'Película',
    poster: d.poster_path
      ? `https://image.tmdb.org/t/p/w500${d.poster_path}`
      : 'https://via.placeholder.com/170x240?text=Sin+Imagen',
    overview: d.overview || '',
    year: (d.release_date || d.first_air_date || '').slice(0, 4),
    director: director || 'Desconocido',
    genres: (d.genres || []).slice(0, 2).map((g) => g.name),
    cast: (d.credits?.cast || []).slice(0, 5).map((c) => c.name)
  };

  await stateRef(chatId).set({ step: 'WAITING_URL', movie });

  const caption =
    `📌 ${movie.title} (${movie.year || 's/f'})\n\n` +
    `${movie.overview.slice(0, 300)}\n\n` +
    `👉 Envíame ahora la URL del vídeo (OK.RU, YouTube, Rumble…). Usa /cancelar para salir.`;

  return d.poster_path ? sendPhoto(chatId, movie.poster, caption) : sendMessage(chatId, caption);
}

async function saveUrl(chatId, url) {
  const snap = await stateRef(chatId).get();
  const { movie } = snap.data();

  await db.collection('movies').add({
    ...movie,
    url,
    tags: [],
    visible: true,
    // Timestamp real: index.html ordena "Añadidos recientemente" con createdAt.seconds
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await stateRef(chatId).delete();
  return sendMessage(chatId, `✅ ${movie.title} añadida a tu videoteca.`);
}

// ---------- Handler ----------
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('Bot activo');

  // Comprueba que la petición viene de Telegram (secret_token del setWebhook)
  if (TELEGRAM_WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const { message, callback_query } = req.body || {};
    const chatId = String((message || callback_query?.message)?.chat?.id || '');

    // Solo tu usuario; si MY_CHAT_ID no está definido, no responde a nadie
    if (!chatId || !MY_CHAT_ID || chatId !== String(MY_CHAT_ID)) {
      return res.status(200).send('OK');
    }

    // Pulsación de un botón de la lista de resultados
    if (callback_query) {
      await tg('answerCallbackQuery', { callback_query_id: callback_query.id });
      const [action, mediaType, id] = (callback_query.data || '').split(':');
      if (action === 'pick' && ['movie', 'tv'].includes(mediaType) && /^\d+$/.test(id)) {
        await pickTitle(chatId, mediaType, id);
      }
      return res.status(200).send('OK');
    }

    const text = message?.text?.trim();
    if (!text) return res.status(200).send('OK');

    if (text === '/start' || text === '/ayuda') {
      await sendMessage(chatId, '🎬 CineStream Bot\nEscríbeme el título de una película o serie, elige el resultado correcto y envíame la URL del vídeo.');
    } else if (text === '/cancelar') {
      await stateRef(chatId).delete();
      await sendMessage(chatId, '🚫 Operación cancelada.');
    } else {
      const state = (await stateRef(chatId).get()).data();
      if (state?.step === 'WAITING_URL') {
        if (isValidUrl(text)) {
          await saveUrl(chatId, text);
        } else {
          await sendMessage(chatId, '⚠️ Eso no parece una URL válida (debe empezar por http:// o https://). Envíala de nuevo o usa /cancelar.');
        }
      } else {
        await sendMessage(chatId, `🔍 Buscando "${text}" en TMDB...`);
        await searchTitles(chatId, text);
      }
    }
  } catch (err) {
    console.error('Error en el bot:', err);
  }

  // Siempre 200: si no, Telegram reintenta el mismo mensaje en bucle
  return res.status(200).send('OK');
};
