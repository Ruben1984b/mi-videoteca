const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // Configuración de cabeceras CORS
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
    
    // Petición simulando un navegador de escritorio completo
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      maxRedirects: 5,
      timeout: 6000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // Búsqueda amplia de enlaces que contengan /video/ en la estructura de OK.RU
    $('a[href*="/video/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const match = href.match(/\/video\/(\d+)/);
      if (match && match[1]) {
        const videoId = match[1];
        
        // Intentar obtener el título desde el texto del enlace o contenedores padre
        let title = $(el).text().trim() || 
                    $(el).attr('title') || 
                    $(el).closest('.video-card, .v-card, .portlet_b, .vid-card').find('.video-card_n, .video-card_name, .ellip, .vid-card_n').text().trim();

        // Filtrar enlaces secundarios sin título descriptivo
        if (title && title.length > 2 && !title.toLowerCase().includes('ok.ru')) {
          results.push({
            source: 'okru',
            sourceName: 'OK.RU',
            title: title,
            duration: 'N/A',
            embedUrl: `https://ok.ru/videoembed/${videoId}`
          });
        }
      }
    });

    // Depurar duplicados
    const unique = Array.from(new Map(results.map(item => [item.embedUrl, item])).values());
    
    return res.status(200).json(unique.slice(0, 10));

  } catch (error) {
    console.error('Error buscando en OK.RU desde la API:', error.message);
    return res.status(200).json([]);
  }
};