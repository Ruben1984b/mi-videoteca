// Limpieza unificada de títulos (la usaban urlinfo.js y bot.js con pequeñas diferencias).
const cleanTitle = (t) =>
  String(t || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/\[[^\]]*\]|\([^)]*(?:HD|latino|castellano|español|completa)[^)]*\)/gi, ' ')
    .replace(/\b(pel[ií]cula completa|completa|full hd|hd|1080p|720p|espa[ñn]ol|latino|castellano|online|gratis)\b/gi, ' ')
    .replace(/[|•–—-]+\s*(ok\.ru|odnoklassniki|youtube).*$/i, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim();

module.exports = { cleanTitle };