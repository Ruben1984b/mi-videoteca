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
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

async function searchTitles(chatId, rawQuery) {
  // "Primos 2011" o "Primos (2011)": el año afina la búsqueda y evita carátulas de otras películas
  const ym = rawQuery.match(/^(.*?)[\s(]+((?:19|20)\d{2})\)?\s*$/);
  const query = ym ? ym[1].trim() : rawQuery;
  const year = ym ? ym[2] : '';
  const data = await tmdb('/search/multi', { query });
  let results = (data.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv'); // descarta personas
  if (year) {
    const byYear = results.filter((r) => (r.release_date || r.first_air_date || '').startsWith(year));
    if (byYear.length) results = byYear;
  }
  // Coincidencias exactas de título primero (orden estable: conserva la popularidad de TMDB)
  const exact = (r) => [r.title, r.name, r.original_title, r.original_name].some((t) => norm(t) === norm(query));
  results = [...results.filter(exact), ...results.filter((r) => !exact(r))].slice(0, 5);

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
    tmdbId: d.id,
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

  const pending = (await stateRef(chatId).get()).data()?.url;
  await stateRef(chatId).set({ step: 'WAITING_URL', movie });
  if (pending) return saveUrl(chatId, pending); // el enlace ya venía de OK.RU: se guarda directamente

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

// ---------- Reposición de enlaces caídos ----------
async function startReplace(chatId, id) {
  const snap = await db.collection('movies').doc(id).get();
  if (!snap.exists) return sendMessage(chatId, '❌ Ese título ya no existe.');
  await stateRef(chatId).set({ step: 'REPLACE', id });
  return sendMessage(chatId, `🔗 Envíame el enlace nuevo para "${snap.data().title}" (o /cancelar).`);
}

async function replaceUrl(chatId, id, url) {
  await db.collection('movies').doc(id).update({ url, broken: false });
  await stateRef(chatId).delete();
  return sendMessage(chatId, '✅ Enlace actualizado.');
}

// ---------- Enlaces de OK.RU ----------
const OK_RE = /ok\.ru\/(?:video|videoembed)\/(\d+)/;

const cleanTitle = (t) =>
  t
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'")
    .replace(/\[[^\]]*\]|\([^)]*(?:HD|latino|castellano|español|completa)[^)]*\)/gi, ' ')
    .replace(/\b(pel[ií]cula completa|completa|full hd|hd|1080p|720p|espa[ñn]ol|latino|castellano|online|gratis)\b/gi, ' ')
    .replace(/[|•–—-]+\s*(ok\.ru|odnoklassniki).*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Pegas un enlace de OK.RU: se lee el título de la página, se buscan coincidencias en TMDB y al elegir se guarda
async function handleOkLink(chatId, link) {
  const id = link.match(OK_RE)[1];
  let title = '';
  try {
    const r = await fetch(`https://ok.ru/video/${id}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9'
      },
      signal: AbortSignal.timeout(7000)
    });
    title = cleanTitle((((await r.text()).match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)) || [])[1] || '');
  } catch {
    /* sin título: se pedirá a mano */
  }
  await stateRef(chatId).set({ step: 'PICK', url: `https://ok.ru/videoembed/${id}` });
  if (!title) {
    return sendMessage(chatId, '⚠️ No pude leer el título de ese vídeo. Escríbeme el título (mejor con el año) y lo asocio al enlace.');
  }
  await sendMessage(chatId, `🔗 Título detectado: "${title}"`);
  return searchTitles(chatId, title);
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
      if (action === 'fix' && /^[A-Za-z0-9]{10,40}$/.test(mediaType || '')) {
        await startReplace(chatId, mediaType); // botón "Reponer enlace" del aviso de enlace caído
        return res.status(200).send('OK');
      }
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
      if (state?.step === 'REPLACE') {
        if (isValidUrl(text)) await replaceUrl(chatId, state.id, text);
        else await sendMessage(chatId, '⚠️ Eso no parece una URL válida. Envíala de nuevo o usa /cancelar.');
      } else if (state?.step === 'WAITING_URL') {
        if (isValidUrl(text)) {
          await saveUrl(chatId, text);
        } else {
          await sendMessage(chatId, '⚠️ Eso no parece una URL válida (debe empezar por http:// o https://). Envíala de nuevo o usa /cancelar.');
        }
      } else if (OK_RE.test(text)) {
        await handleOkLink(chatId, text);
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
