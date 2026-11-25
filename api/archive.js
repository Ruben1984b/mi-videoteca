const { requireAdmin } = require('./_auth');

module.exports = async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Falta el título a buscar' });

  try {
    // 1. Buscar en el catálogo de Archive.org
    const url = `https://archive.org/advancedsearch.php?q=title:(${encodeURIComponent(q)})+AND+mediatype:(movies)&fl[]=identifier&fl[]=title&fl[]=year&sort[]=downloads+desc&rows=15&output=json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('Error consultando Archive.org');
    const data = await r.json();
    const docs = data.response?.docs || [];

    // 2. Para cada resultado, buscar si tiene un archivo .mp4
    const results = await Promise.all(docs.map(async (doc) => {
      try {
        const metaR = await fetch(`https://archive.org/metadata/${doc.identifier}`, { signal: AbortSignal.timeout(5000) });
        const meta = await metaR.json();
        const mp4File = meta.files?.find(f => f.name.endsWith('.mp4') && f.source === 'original') || 
                        meta.files?.find(f => f.name.endsWith('.mp4'));
        
        if (mp4File) {
          return {
            title: doc.title,
            year: doc.year || '',
            poster: `https://archive.org/services/img/${doc.identifier}`,
            url: `https://archive.org/download/${doc.identifier}/${mp4File.name}`,
            source: 'Archive.org'
          };
        }
      } catch (e) { return null; }
      return null;
    }));

    res.status(200).json(results.filter(Boolean));
  } catch (e) {
    console.error('archive:', e.message);
    res.status(500).json({ error: 'Error interno al buscar en Archive.org' });
  }
};