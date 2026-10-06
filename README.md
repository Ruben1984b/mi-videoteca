# CineStream · Mi Videoteca

Reproductor privado para Smart TV (mando a distancia) y móvil.
HTML/JS vanilla + Firebase Firestore + funciones serverless en Vercel + bot de Telegram.

## Archivos

| Archivo | Función |
|---|---|
| `index.html` | Reproductor y catálogo. Al abrir un título se reproduce solo. |
| `admin.html` | Panel de gestión (pendiente de revisión). |
| `api/bot.js` | Webhook del bot de Telegram (alta de títulos). |
| `api/okru.js` | Sin uso: ningún archivo lo llama. Puedes borrarlo (y `axios`/`cheerio` del `package.json`). |

## Despliegue (flujo habitual)

Vercel está conectado al repositorio: **cada `git push` a `main` despliega solo**.

```bash
git add .
git commit -m "Mejoras reproductor y bot"
git push origin main
```

En Vercel → Deployments comprueba que el último despliegue queda en **Ready**.

## Configuración única (antes del primer push)

### 1. Variables de entorno en Vercel
Project → Settings → Environment Variables (marca Production, Preview y Development):

| Variable | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token de @BotFather (ya la tienes) |
| `MY_CHAT_ID` | Tu ID de Telegram (ya la tienes). Si falta, el bot no responde a nadie. |
| `TMDB_API_KEY` | **Clave nueva** de TMDB (la anterior estaba en el código: regénerala en themoviedb.org → Ajustes → API) |
| `TELEGRAM_WEBHOOK_SECRET` | Cadena aleatoria larga (solo letras y números) |
| `FIREBASE_SERVICE_ACCOUNT` | Contenido completo del JSON de la cuenta de servicio (paso 2) |

Después de añadir o cambiar variables hay que **redesplegar** (Deployments → ⋯ → Redeploy) para que se apliquen.

### 2. Cuenta de servicio de Firebase
Firebase Console → ⚙ Configuración del proyecto → Cuentas de servicio → **Generar nueva clave privada**.
Pega el JSON entero en `FIREBASE_SERVICE_ACCOUNT`. **No subas ese archivo a GitHub.**

### 3. Registrar el webhook de Telegram
Abre una vez en el navegador (sustituye los valores):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://mi-videoteca-woad.vercel.app/api/bot&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Debe responder `{"ok":true,...}`. Para comprobarlo: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`.

### 4. Reglas de Firestore
**No las cierres todavía.** `admin.html` aún escribe desde el navegador sin login y dejaría de funcionar.
Cuando `admin.html` tenga login, usa estas reglas (el bot usa Admin SDK y las ignora):

```
match /movies/{id} {
  allow read: if true;
  allow write: if request.auth != null
    && request.auth.token.email == "TU_CORREO"
    && request.auth.token.email_verified == true;
}
```

### 5. Claves que debes regenerar
Estaban en el código del repo: TMDB, Google Custom Search y YouTube Data (Google Cloud Console → Credenciales). Las de Google no se usan, bórralas.
Si el repo es público, considera que las antiguas están comprometidas aunque las quites (siguen en el historial de git).

## Comprobación tras desplegar

1. Abre la web: el catálogo carga (si falla, aparece el error en pantalla).
2. Pulsa Intro sobre una película: arranca sola a pantalla completa.
3. Telegram: escribe un título → aparecen hasta 5 resultados → elige uno → envía la URL → "✅ añadida".
4. Recarga la web: el título nuevo aparece en "Añadidos recientemente".

Si el bot no contesta: Vercel → Logs (filtra por `/api/bot`) y `getWebhookInfo` (campo `last_error_message`).

## Manejo con el mando

| Tecla | Acción |
|---|---|
| Flechas | Moverse por catálogo, filtros y botones |
| Intro | Abrir/reproducir el título (en reproducción: pausa) |
| ← / → en reproducción | −10 s / +10 s |
| ↑ en reproducción | Botón Info / Episodios |
| ↓ en reproducción | Siguiente episodio (si existe) |
| `i` / Menú | Ficha del título |
| Atrás | Cierra ficha o reproductor |

## Limitaciones conocidas

- **Reanudar, saltos de ±10 s, pausa y siguiente episodio automático** solo funcionan con YouTube. OK.RU, Dailymotion y Rumble no exponen API de control: usan sus propios controles.
- En servidores que no son YouTube, con el foco dentro del reproductor las teclas del mando las recibe el vídeo; el botón Atrás del mando sigue cerrando el reproductor porque se gestiona con el historial del navegador.
- Rumble: las páginas `rumble.com/vXXXX-titulo.html` suelen no ser incrustables. Guarda la URL `rumble.com/embed/...`.
- El progreso y los "vistos" se guardan por dispositivo (`localStorage`); no se sincronizan entre TV y móvil.
