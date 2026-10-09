// ==UserScript==
// @name         CineStream · Copiar vídeos de OK.RU
// @namespace    cinestream
// @version      1.0
// @description  Copia los vídeos que ves en OK.RU en el formato del panel "Novedades" del admin de CineStream
// @match        https://ok.ru/*
// @match        https://*.ok.ru/*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const ID_RE = /\/video\/(\d{6,})/;
  const isDuration = (t) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();

  // Lee los enlaces de vídeo que hay en pantalla y devuelve líneas "Título | URL | Película"
  function collect() {
    const found = new Map();
    document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(ID_RE);
      if (!m) return;
      const card = a.closest('li, article, [class*="card"], [class*="video"]');
      const named = card && card.querySelector('[class*="name"], [class*="title"], [class*="ellip"]');
      // Se usa la primera fuente de título válida, por orden de fiabilidad
      const title = [a.getAttribute('title'), a.getAttribute('aria-label'), named && named.textContent, a.textContent]
        .map(norm)
        .find((t) => t.length > 2 && !isDuration(t) && !/^ok\.ru$/i.test(t));
      if (title && !found.has(m[1])) found.set(m[1], title);
    });
    return [...found].map(([id, t]) => `${t.replace(/\|/g, '/')} | https://ok.ru/video/${id} | Película`);
  }

  // Hace scroll unas cuantas veces para que OK.RU cargue más vídeos
  async function loadMore() {
    let last = -1;
    for (let i = 0; i < 6; i++) {
      const n = document.querySelectorAll('a[href*="/video/"]').length;
      if (n === last) break;
      last = n;
      window.scrollTo(0, document.body.scrollHeight);
      await wait(1200);
    }
    window.scrollTo(0, 0);
  }

  const LABEL = '🎬 Copiar para CineStream';
  const btn = document.createElement('button');
  btn.textContent = LABEL;
  btn.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 14px;background:#e50914;color:#fff;border:0;border-radius:8px;font:600 14px sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.4)';

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Cargando vídeos…';
    await loadMore();
    const lines = collect();
    if (!lines.length) {
      btn.textContent = '⚠ No encontré vídeos en esta página';
    } else {
      const text = lines.join('\n');
      try {
        GM_setClipboard(text);
      } catch {
        await navigator.clipboard.writeText(text);
      }
      btn.textContent = `✅ ${lines.length} copiados: pégalos en el admin`;
    }
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = LABEL;
    }, 3500);
  };
  document.body.appendChild(btn);
})();
