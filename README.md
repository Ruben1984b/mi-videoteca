# CineStream · Mi Videoteca

Reproductor privado para Smart TV (mando a distancia) y móvil.
HTML/JS vanilla + Firebase Firestore + funciones serverless en Vercel + bot de Telegram.

## Archivos

| Archivo | Función |
|---|---|
| `index.html` | Reproductor y catálogo. Al abrir un título se reproduce solo. |
| `admin.html` | Panel de gestión con login (altas, edición, episodios, enlaces, backup). |
| `vercel.json` | Cabeceras `noindex` y seguridad básica (se aplican solas al desplegar). |
| `api/bot.js` | Webhook del bot de Telegram (alta de títulos). |
| `api/tmdb.js` | Proxy de TMDB para el admin (la clave nunca llega al navegador). |
| `api/check.js` | Comprobador de enlaces caídos para el admin. |
| `api/report.js` | Recibe el aviso "🚩 Enlace caído" del reproductor y marca el título (`broken`). |
| `api/urlinfo.js` | Lee el título de un enlace (YouTube/OK.RU) para autocompletar el alta en el admin. |
| `api/okru-test.js` | Prueba de viabilidad: ¿puede el servidor leer páginas de OK.RU? (botón 🧪 del admin). |
| `api/_auth.js` | Utilidad interna: solo deja pasar a `ADMIN_EMAIL`. No es un endpoint. |
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
| `ADMIN_EMAIL` | Tu correo de acceso al panel (paso 4). Sin él, `/api/tmdb` y `/api/check` rechazan todo. |

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

### 4. Login del admin
1. Firebase Console → Authentication → Sign-in method → activa **Correo electrónico/contraseña**.
2. Authentication → Users → **Añadir usuario** con tu correo y una contraseña larga.
3. Añade en Vercel la variable `ADMIN_EMAIL` con ese mismo correo y redespliega.
4. Authentication → Settings → Authorized domains: comprueba que está `mi-videoteca-woad.vercel.app`.
5. Para impedir que alguien cree cuentas nuevas, puedes desactivar los registros en Authentication → Settings → User actions (Enable create/sign-up).

### 5. Reglas de Firestore
Hazlo **después** de comprobar que puedes entrar en `/admin.html` y guardar un título.
Firestore Console → Reglas (el bot usa Admin SDK y las ignora):

```
match /movies/{id} {
  allow read: if true;
  allow write: if request.auth != null
    && request.auth.token.email == "TU_CORREO";
}
```

Comprueba después: sin sesión, `/admin.html` pide login; con sesión, puedes añadir y borrar.

### 6. Claves que debes regenerar
Estaban en el código del repo: TMDB, Google Custom Search y YouTube Data (Google Cloud Console → Credenciales). Las de Google no se usan, bórralas.
Si el repo es público, considera que las antiguas están comprometidas aunque las quites (siguen en el historial de git).

## Comprobación tras desplegar

1. Abre la web: el catálogo carga (si falla, aparece el error en pantalla).
2. Pulsa Intro sobre una película: arranca sola a pantalla completa.
3. Telegram: escribe un título → aparecen hasta 5 resultados → elige uno → envía la URL → "✅ añadida".
4. Recarga la web: el título nuevo aparece en "Añadidos recientemente".
5. `/admin.html`: pide login; añade un título y comprueba que trae portada y sinopsis de TMDB.
6. En el admin pulsa "Verificar enlaces": los badges pasan a 🟢 o 🔴 (el motivo sale al pasar el ratón).
7. Exporta un backup e impórtalo: no debe duplicar títulos (conserva los IDs).

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

## Novedades de OK.RU (script de Tampermonkey)

1. Instala la extensión Tampermonkey en el navegador del ordenador.
2. Abre `https://mi-videoteca-woad.vercel.app/tools/cinestream-okru.user.js` y pulsa **Instalar**.
3. En OK.RU, inicia sesión con tu cuenta si te lo pide y abre la página de vídeos de uno de esos usuarios.
4. Pulsa el botón rojo **🎬 Copiar para CineStream** (abajo a la derecha). Hace scroll solo para cargar más vídeos y copia la lista.
5. En `/admin.html` → **Novedades de OK.RU**: pega la lista y pulsa **Analizar**.
6. Cada vídeo nuevo tiene **➕ Añadir** (abre el selector de TMDB) o **🚫 Ignorar**. Los que ya están en el catálogo se descartan solos.

Límites: es semiautomático y solo ve los vídeos que OK.RU carga en pantalla. Si OK.RU cambia su HTML, habrá que retocar el script. Lo ignorado se recuerda en ese navegador.

## Reproductor: botones e imagen

- Los botones de la parte superior (Info, Enlace caído, Imagen) **no se muestran durante la reproducción**. Aparecen 4 segundos al pulsar **↑** (o mover el ratón / tocar la pantalla). Con ↑ repetido se salta entre ellos; **↓** va a "Siguiente".
- **✨ Imagen** alterna Original / Suave / Nítida y se recuerda. *Suave* sube un poco contraste y color; *Nítida* añade un filtro de nitidez que consume más: si la imagen va a saltos en tu TV Box, usa Suave u Original.
- Estos filtros mejoran la imagen que se ve, pero no recuperan detalle que el vídeo original no tiene. El audio de OK.RU/YouTube va dentro de su propio reproductor y esta página no puede procesarlo.

## TokyVideo

La URL de la página (`tokyvideo.com/fr/video/titulo`) no se puede reproducir dentro del reproductor: hace falta el enlace **embed**, con la forma `https://www.tokyvideo.com/IDIOMA/embed/NÚMERO`.

- **Automático:** al pegar la URL de una página de TokyVideo en el admin (al añadir o al editar), se convierte sola y se comprueba que el embed responde.
- **El idioma de la ruta importa:** debe coincidir con el del vídeo. Por ejemplo, un vídeo de la sección francesa funciona con `/fr/embed/800655` y responde "no existe" con `/es/embed/800655`.
- **Manual:** en la página del vídeo, botón **`</>`** (código de integración, puede pedir una cuenta gratuita), y copia la dirección tras `src=`.
- Si el embed responde "el vídeo solicitado no existe o ha sido borrado" con todos los idiomas, ese vídeo no permite incrustarse o fue retirado.
- Los enlaces directos `.mp4` de TokyVideo llevan una firma que caduca, así que no sirven para guardar.
- El reproductor de TokyVideo puede mostrar anuncios y no empezar solo; con el mando, pulsa Intro dentro del vídeo.

## VK Vídeo

Se puede pegar el enlace de la página tal cual (`vk.com/video-123_456`, `vk.ru/…` o `m.vkvideo.ru/…`): el reproductor lo convierte a `https://vk.ru/video_ext.php?oid=…&id=…`.

- Si el vídeo es privado o restringido, el reproductor de VK puede decir que no está disponible. En ese caso, en la página del vídeo usa **Compartir → Código de inserción** y pega en el campo URL la dirección que aparece tras `src=` (incluye un `hash`). El reproductor la acepta tal cual.
- Algunos vídeos tienen restricciones por país.
- Igual que OK.RU, no hay saltos de ±10 s ni reanudar: se usan los controles del propio reproductor de VK.

## Importar una lista de YouTube como episodios

Sirve para series que están en una lista de reproducción de YouTube (`youtube.com/playlist?list=…`).

**Al añadir una serie nueva:** pon la categoría **Serie**, pega la URL de la lista en el campo URL e indica la temporada en *Temp. (listas)* (vacío = 1). Se crea el título con todos los episodios, numerados como `2x01 - Título`.

**En una serie que ya existe:** ✏️ no, el botón **📺** → pega la URL de la lista y la temporada → **📥 Importar lista de YouTube** → revisa los títulos, quita con ✕ los vídeos que sobren (extras, avances…) → **Guardar episodios**. Los episodios que ya estaban no se duplican, y se pueden importar varias temporadas seguidas.

- Funciona sin configuración leyendo la página pública de la lista (hasta unos 100 vídeos). Opcionalmente, si añades la variable `YOUTUBE_API_KEY` en Vercel, usa la API oficial de YouTube, que es más estable y no tiene límite de 100.
- Los vídeos privados o eliminados se descartan. Si el dueño de un vídeo no permite incrustarlo, ese episodio no se reproducirá en el reproductor.
- La numeración `2x01` hace que el reproductor agrupe los episodios por temporada.

## Series con varias temporadas y control de episodios vistos

- **Una sola carátula por serie.** Al añadir otra temporada desde una lista de YouTube con el mismo título de serie, el admin detecta que ya existe y ofrece **añadir los episodios como temporada N a esa serie** (en lugar de crear otra). También puedes hacerlo desde 📺 → importar lista.
- **En la ficha de la serie:** pestañas de temporada con su contador (`Temporada 2 (5/25)`), que se abre en la temporada del último episodio que viste. Pulsa un episodio para reproducirlo.
- **Episodios vistos:** salen con ✓ y atenuados. El botón ✓ / ↺ junto a cada episodio lo marca o desmarca a mano. Se marcan solos al terminarlos y, en vídeos de YouTube, al pasar el 90 %.
- **Visto de la serie:** si marcas todos los episodios, la serie pasa a "Vistos"; "Marcar como visto/no visto" de la serie marca o desmarca todos a la vez.
- **En la tarjeta** de la serie aparece el avance (`12/47`).
- Lo visto se guarda por dispositivo (como el progreso).
