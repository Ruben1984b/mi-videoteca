const TMDB_API_KEY = "3a05c1588b2c57b0cfe5fe1e57444271";
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MY_CHAT_ID = process.env.MY_CHAT_ID; // Tu ID para limitar el acceso

// Memoria temporal simple para guardar el estado del diálogo
let userState = {};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot activo');
  }

  const { message } = req.body;
  if (!message || !message.text) return res.status(200).send('OK');

  const chatId = message.chat.id.toString();
  const text = message.text.trim();

  // Control de seguridad: solo responde a tu usuario
  if (MY_CHAT_ID && chatId !== MY_CHAT_ID) {
    await sendMessage(chatId, "⛔ No estás autorizado para usar este bot.");
    return res.status(200).send('OK');
  }

  // Estado 1: El bot está esperando que le envíes el enlace
  if (userState[chatId] && userState[chatId].step === 'WAITING_URL') {
    const movieData = userState[chatId].movie;
    const videoUrl = text;

    // Guardar en Firestore usando la API REST nativa de Firebase
    const saved = await saveToFirestore({
      title: movieData.title,
      url: videoUrl,
      category: movieData.category || 'Película',
      poster: movieData.poster,
      overview: movieData.overview,
      year: movieData.year,
      director: movieData.director,
      visible: true,
      createdAt: new Date().toISOString()
    });

    delete userState[chatId]; // Limpiar estado

    if (saved) {
      await sendMessage(chatId, `✅ **${movieData.title}** ha sido añadida correctamente a tu videoteca.`);
    } else {
      await sendMessage(chatId, `❌ Hubo un error al guardar en Firestore.`);
    }
    return res.status(200).send('OK');
  }

  // Comando /start o /ayuda
  if (text === '/start' || text === '/ayuda') {
    await sendMessage(chatId, "🎬 **CineStream Bot**\nEscríbeme el título de una película o serie para buscarla en TMDB y añadirla a tu catálogo.");
    return res.status(200).send('OK');
  }

  // Búsqueda en TMDB al escribir cualquier título
  await sendMessage(chatId, `🔍 Buscando "${text}" en TMDB...`);
  const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=\({TMDB_API_KEY}&language=es-ES&query=\){encodeURIComponent(text)}`);
  const tmdbData = await tmdbRes.json();

  if (!tmdbData.results || tmdbData.results.length === 0) {
    await sendMessage(chatId, "❌ No encontré ningún resultado con ese título.");
    return res.status(200).send('OK');
  }

  const match = tmdbData.results[0];
  const isTv = match.media_type === 'tv';
  const title = isTv ? match.name : match.title;
  const poster = match.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : '';
  const year = (match.release_date || match.first_air_date || '').split('-')[0];

  // Guardamos el resultado en la memoria
  userState[chatId] = {
    step: 'WAITING_URL',
    movie: {
      title,
      category: isTv ? 'Serie' : 'Película',
      poster,
      overview: match.overview || '',
      year,
      director: 'Desconocido'
    }
  };

  // Enviamos la foto con la confirmación
  if (poster) {
    await sendPhoto(chatId, poster, `📌 **\({title}** (\){year})\n\n${match.overview ? match.overview.slice(0, 150) + '...' : ''}\n\n👉 **Envíame ahora la URL del vídeo** (OK.RU, YouTube, Rumble...) para completarla.`);
  } else {
    await sendMessage(chatId, `📌 **\({title}** (\){year})\n\n👉 **Envíame ahora la URL del vídeo** para completarla.`);
  }

  return res.status(200).send('OK');
}

// Funciones auxiliares para la API de Telegram y Firestore
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

async function sendPhoto(chatId, photoUrl, caption) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: 'Markdown' })
  });
}

async function saveToFirestore(data) {
  try {
    const projectId = "mi-reproductor-privado";
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/movies`;
    
    // Convertimos el JSON llano al formato de campos que exige la REST API de Firestore
    const fields = {};
    for (const key in data) {
      if (typeof data[key] === 'boolean') fields[key] = { booleanValue: data[key] };
      else fields[key] = { stringValue: data[key].toString() };
    }

    const res = await fetch(firestoreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}