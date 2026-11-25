const { admin } = require('./_firebase');

module.exports = async (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';

  if (!token) return res.status(200).json({ isAdmin: false });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const expected = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const isAdmin = (decoded.email || '').toLowerCase() === expected;
    
    res.status(200).json({ isAdmin });
  } catch (e) {
    res.status(200).json({ isAdmin: false });
  }
};