const db = require('./db');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function requirePaid(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  const player = db.prepare('SELECT paid FROM players WHERE id = ?').get(req.session.userId);
  if (!player) {
    return req.session.destroy(() => res.redirect('/login'));
  }
  if (player.paid !== 1) return res.redirect('/pay');
  next();
}

// Admin routes redirect to /login on any failure (auth missing, email mismatch,
// ADMIN_EMAIL unset) so the route's existence isn't revealed.
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  if (!process.env.ADMIN_EMAIL) return res.redirect('/login');
  if (req.session.email !== process.env.ADMIN_EMAIL) return res.redirect('/login');
  next();
}

module.exports = { requireAuth, requirePaid, requireAdmin };
