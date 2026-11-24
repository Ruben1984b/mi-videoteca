const { admin } = require('./_firebase');
const { tmdb } = require('./_tmdb');
const { cleanTitle } = require('./_text');
const { isAllowedUrl } = require('./_hosts');
const { readFirstBytes } = require('./_http');

const { TELEGRAM_BOT_TOKEN, MY_CHAT_ID, TELEGRAM_WEBHOOK_SECRET } = process.env;

const db = admin.firestore();
const stateRef = (chatId) => db.collection('botState').doc(String(chatId));

const STATE_TTL_MS = 30 * 60 * 1000; // 30 minutos

async function getState(chatId) {
  const snap = await stateRef(chatId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  // Si existe una fecha de expiración y ya pasó, borramos y devolvemos null
  if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
    await snap.ref.delete();
    return null;
  }
  return data;
}

async function setState(chatId, data) {
  return stateRef(chatId).set({
    ...data,
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + STATE_TTL_MS)
  });
}

async function clearState(chatId) {
  return stateRef(chatId).delete();
}

const tg = (method, body) =>
  fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

const sendMessage = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, ...extra });
const sendPhoto = (chat_id, photo, caption) => tg('sendPhoto', { chat_id, photo, caption });

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

async function searchTitles(chatId, rawQuery) {
  const ym = rawQuery.match(/^(.*?)[\s(]+((?:19|20)\d{2})\)?\s*$/);
  const query = ym ? ym[1].trim() : rawQuery;
  const year = ym ? ym[2] : '';
  const data = await tmdb('/search/multi', { query });
  let results = (data.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
  if (year) {
    const byYear = results.filter((r) => (r.release_date || r.first_air_date || '').startsWith(year));
    if (byYear.length) results = byYear;
  }
  const exact = (r) => [r.title, r.name, r.original_title, r.original_name].some((t) => norm(t) === norm(query));
  results = [...results.filter(exact), ...results.filter((r) => !exact(r))].slice(0, 5);

  if (!results.length) {
    return sendMessage(chatId, '❌ No encontré ninguna película o serie. Prueba con el título original o el nombre exacto.');
  }

  const keyboard = results.map((r) => {
    const title = r.title || r.name;
    const yr = (r.release_date || r.first_air_date || '').slice(0, 4) || 's/f';
    const icon = r.media_type === 'tv' ? '📺' : '🎬';
    return [{ text: `${icon} ${title} (${yr})`.slice(0, 60), callback_data: `pick:${r.media_type}:${r.id}` }];
  });

  return sendMessage(chatId, 'Elige el título correcto:', { reply_markup: { inline_keyboard: keyboard } });
}

async function pickTitle(chatId, mediaType, id) {
  const d = await tmdb(`/${mediaType}/${id}`, { append_to_response: 'credits' });
  const isTv = mediaType === 'tv';

  const director = isTv
    ? (d.created_by || []).map((c) => c.name).join(', ')
    : (d.credits?.crew || []).find((c) => c.job === 'Director')?.name || '';

  const movie = {
    tmdbId: d.id,
    title: isTv ? d.name : d.title,
    category: isTv ? 'Serie' : 'Película',
    poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '',
    overview: d.overview || '',
    year: (d.release_date || d.first_air_date || '').slice(0, 4),
    director: director || 'Desconocido',
    genres: (d.genres || []).slice(0, 2).map((g) => g.name),
    cast: (d.credits?.cast || []).slice(0, 5).map((c) => c.name),
  };

  const prevState = await getState(chatId);
  const pending = prevState?.url;
  
  await setState(chatId, { step: 'WAITING_URL', movie, ...(pending ? { url: pending } : {}) });
  if (pending) return saveUrl(chatId, pending);

  const caption =
    `📌 ${movie.title} (${movie.year || 's/f'})\n\n` +
    `${movie.overview.slice(0, 300)}\n\n` +
    `👉 Envíame ahora la URL del vídeo (OK.RU, YouTube, Rumble…). Usa /cancelar para salir.`;

  return d.poster_path ? sendPhoto(chatId, movie.poster, caption) : sendMessage(chatId, caption);
}

async function saveUrl(chatId, url) {
  const state = await getState(chatId);
  if (!state || !state.movie) return sendMessage(chatId, '⚠️ No hay ninguna película seleccionada. Empieza de nuevo escribiendo un título.');
  
  const { movie } = state;

  await db.collection('movies').add({
    ...movie,
    url,
    tags: [],
    visible: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await clearState(chatId);
  return sendMessage(chatId, `✅ ${movie.title} añadida a tu videoteca.`);
}

async function startReplace(chatId, id) {
  const snap = await db.collection('movies').doc(id).get();
  if (!snap.exists) return sendMessage(chatId, '❌ Ese título ya no existe.');
  await setState(chatId, { step: 'REPLACE', id });
  return sendMessage(chatId, `🔗 Envíame el enlace nuevo para "${snap.data().title}" (o /cancelar).`);
}

async function replaceUrl(chatId, id, url) {
  await db.collection('movies').doc(id).update({ url, broken: false });
  await clearState(chatId);
  return sendMessage(chatId, '✅ Enlace actualizado.');
}

const OK_RE = /ok\.ru\/(?:video|videoembed)\/(\d+)/;

async function handleOkLink(chatId, link) {
  const id = link.match(OK_RE)[1];
  let title = '';
  try {
    const r = await fetch(`https://ok.ru/video/${id}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
      signal: AbortSignal.timeout(7000),
    });
    const html = await readFirstBytes(r, 300_000);
    title = cleanTitle(((html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)) || [])[1] || '');
  } catch {
    /* sin título */
  }
  await setState(chatId, { step: 'PICK', url: `https://ok.ru/videoembed/${id}` });
  if (!title) {
    return sendMessage(chatId, '⚠️ No pude leer el título de ese vídeo. Escríbeme el título (mejor con el año) y lo asocio al enlace.');
  }
  await sendMessage(chatId, `🔗 Título detectado: "${title}"`);
  return searchTitles(chatId, title);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('Bot activo');

  if (TELEGRAM_WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).send('Bad JSON'); }
  }

  try {
    const { message, callback_query } = body || {};
    const chatId = String((message || callback_query?.message)?.chat?.id || '');

    if (!chatId || !MY_CHAT_ID || chatId !== String(MY_CHAT_ID)) {
      return res.status(200).send('OK');
    }

    if (callback_query) {
      await tg('answerCallbackQuery', { callback_query_id: callback_query.id });
      const [action, mediaType, id] = (callback_query.data || '').split(':');
      if (action === 'fix' && /^[A-Za-z0-9]{10,40}$/.test(mediaType || '')) {
        await startReplace(chatId, mediaType);
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
      await clearState(chatId);
      await sendMessage(chatId, '🚫 Operación cancelada.');
    } else {
      const state = await getState(chatId);
      if (state?.step === 'REPLACE') {
        if (isAllowedUrl(text)) await replaceUrl(chatId, state.id, text);
        else await sendMessage(chatId, '⚠️ Eso no parece una URL válida. Envíala de nuevo o usa /cancelar.');
      } else if (state?.step === 'WAITING_URL') {
        if (isAllowedUrl(text)) {
          await saveUrl(chatId, text);
        } else {
          await sendMessage(chatId, '⚠️ Esa URL no es de una plataforma soportada. Envíala de nuevo o usa /cancelar.');
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
    try {
      const fallbackChat = String(req.body?.message?.chat?.id || '');
      if (fallbackChat && MY_CHAT_ID && fallbackChat === String(MY_CHAT_ID)) {
        await sendMessage(fallbackChat, '⚠️ Algo falló. Inténtalo de nuevo en un momento o usa /cancelar.');
      }
    } catch { /* noop */ }
  }

  return res.status(200).send('OK');
};