const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../db');
const { requireAuth, requirePaid } = require('../middleware');

const SALT_ROUNDS = 12;
const VALID_NTRP = ['3.0', '3.5', '4.0', '4.5+'];
const normEmail = (e) => (e || '').trim().toLowerCase();

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('register', { error: null, form: {} });
});

router.post('/register', async (req, res) => {
  const { name, password, phone, ntrp, location } = req.body;
  const email = normEmail(req.body.email);
  const form = { name, email, phone, ntrp, location };

  if (!name || !email || !password || !ntrp) return res.render('register', { error: 'Name, email, password, and NTRP are required', form });
  if (!VALID_NTRP.includes(ntrp)) return res.render('register', { error: 'Invalid NTRP rating', form });
  if (password.length < 8) return res.render('register', { error: 'Password must be at least 8 characters', form });

  const season = db.prepare('SELECT id FROM seasons WHERE active = 1').get();
  if (!season) return res.render('register', { error: 'No active season - please contact the administrator', form });

  let passwordHash;
  try { passwordHash = await bcrypt.hash(password, SALT_ROUNDS); }
  catch (err) { console.error('[auth] bcrypt hash failed', err); return res.render('register', { error: 'Server error - please try again', form }); }

  const create = db.transaction(() => {
    const maxRank = db.prepare('SELECT MAX(rank) as m FROM players WHERE season_id = ? AND ntrp = ?').get(season.id, ntrp);
    const newRank = (maxRank.m || 0) + 1;
    const result = db.prepare(`
      INSERT INTO players (season_id, name, email, password_hash, phone, ntrp, location, rank)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(season.id, name, email, passwordHash, phone || null, ntrp, location || null, newRank);
    return { id: result.lastInsertRowid, rank: newRank };
  });

  let player;
  try { player = create(); }
  catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.render('register', { error: 'An account with that email already exists for this season', form });
    console.error('[auth] register failed', err);
    return res.render('register', { error: 'Server error - please try again', form });
  }

  req.session.userId = player.id;
  req.session.playerName = name;
  req.session.userRank = player.rank;
  req.session.email = email;
  res.redirect('/dashboard');
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { error: null, form: {} });
});

router.post('/login', async (req, res) => {
  const { password } = req.body;
  const email = normEmail(req.body.email);
  const form = { email };

  if (!email || !password) return res.render('login', { error: 'Email and password are required', form });

  const season = db.prepare('SELECT id FROM seasons WHERE active = 1').get();
  if (!season) return res.render('login', { error: 'No active season', form });

  const player = db.prepare('SELECT id, name, email, password_hash, rank FROM players WHERE email = ? AND season_id = ?').get(email, season.id);
  if (!player) return res.render('login', { error: 'Invalid email or password', form });

  let valid;
  try { valid = await bcrypt.compare(password, player.password_hash); }
  catch (err) { console.error('[auth] bcrypt compare failed', err); return res.render('login', { error: 'Server error', form }); }
  if (!valid) return res.render('login', { error: 'Invalid email or password', form });

  req.session.userId = player.id;
  req.session.playerName = player.name;
  req.session.userRank = player.rank;
  req.session.email = player.email;
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
router.get('/logout',  (req, res) => req.session.destroy(() => res.redirect('/')));

router.get('/dashboard', requireAuth, requirePaid, (req, res) => {
  const player = db.prepare('SELECT id, name, ntrp, rank, wins, losses FROM players WHERE id = ?').get(req.session.userId);
  if (!player) return req.session.destroy(() => res.redirect('/login'));

  req.session.userRank = player.rank;

  const incoming = db.prepare(`
    SELECT c.*, p.name as challenger_name FROM challenges c
    JOIN players p ON p.id = c.challenger_id
    WHERE c.opponent_id = ? AND c.status = 'pending'
    ORDER BY c.created_at DESC
  `).all(player.id);

  const outgoing = db.prepare(`
    SELECT c.*, p.name as opponent_name FROM challenges c
    JOIN players p ON p.id = c.opponent_id
    WHERE c.challenger_id = ? AND c.status = 'pending'
    ORDER BY c.created_at DESC
  `).all(player.id);

  const counterIncoming = db.prepare(`
    SELECT c.*, p.name as opponent_name FROM challenges c
    JOIN players p ON p.id = c.opponent_id
    WHERE c.challenger_id = ? AND c.status = 'countered'
    ORDER BY c.created_at DESC
  `).all(player.id);

  const toReport = db.prepare(`
    SELECT c.*, ch.name as challenger_name, op.name as opponent_name
    FROM challenges c
    JOIN players ch ON ch.id = c.challenger_id
    JOIN players op ON op.id = c.opponent_id
    WHERE (c.challenger_id = ? OR c.opponent_id = ?) AND c.status = 'accepted'
    ORDER BY c.proposed_time ASC
  `).all(player.id, player.id);

  res.render('dashboard', {
    title: 'Dashboard',
    currentNav: 'dashboard',
    session: req.session,
    player, incoming, outgoing, counterIncoming, toReport
  });
});

module.exports = router;
