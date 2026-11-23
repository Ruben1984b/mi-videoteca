// Whitelist de dominios permitidos para evitar SSRF en fetches externos.
const ALLOWED_HOSTS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com',
  'tokyvideo.com',
  'ok.ru', 'odnoklassniki.ru',
  'dailymotion.com', 'dai.ly',
  'rumble.com',
  'vk.com', 'vk.ru', 'vkvideo.ru',
];

function isAllowedHost(hostname) {
  const host = String(hostname || '').replace(/^www\./, '').toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

function isAllowedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return isAllowedHost(u.hostname);
  } catch {
    return false;
  }
}

module.exports = { ALLOWED_HOSTS, isAllowedHost, isAllowedUrl };