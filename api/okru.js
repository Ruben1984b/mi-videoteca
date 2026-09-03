const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // Encabezados CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { q } = req.query;
  if (!q) {
    return res.status(200).json([]);
  }

  try {
    const searchUrl = `https://ok.ru/search?st.mode=video&st.gsearch=${encodeURIComponent(q)}`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      timeout: 5000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $('.video-card, .v-card, .portlet_b').each((_, el) => {
      const link = $(el).find('a[href*="/video/"]').attr('href');
      const title = $(el).find('.video-card_n, .video-card_name, .ellip').text().trim();
      const duration = $(el).find('.video-card_duration, .video-card_time').text().trim();

      if (link) {
        const match = link.match(/\/video\/(\d+)/);
        if (match && match[1]) {
          results.push({
            source: 'okru',
            sourceName: 'OK.RU',
            title: title || q,
            duration: duration || 'N/A',
            embedUrl: `https://ok.ru/videoembed/${match[1]}`
          });
        }
      }
    });

    // Eliminar duplicados según embedUrl
    const unique = Array.from(new Map(results.map(item => [item.embedUrl, item])).values());
    
    return res.status(200).json(unique.slice(0, 10));

  } catch (error) {
    console.error('Error buscando en OK.RU:', error.message);
    return res.status(200).json([]);
  }
};