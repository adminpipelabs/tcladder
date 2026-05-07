const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../db');
const upload = require('../upload');
const kazi = require('../kazi');
const { requireAuth, requirePaid } = require('../middleware');

const VALID_SPORTS = ['tennis', 'padel', 'pickleball'];
const VALID_SKILL_LEVELS = {
  tennis: ['3.0', '3.5', '4.0', '4.5+'],
  padel: ['beginner', 'intermediate', 'advanced', 'competitive'],
  pickleball: ['beginner', 'intermediate', 'advanced', 'competitive']
};
const normEmail = (e) => (e || '').trim().toLowerCase();
// Strip whitespace, dashes, parentheses; preserve + prefix per gotcha 11.4
const normPhone = (p) => (p || '').replace(/[\s\-\(\)]/g, '');

// === Mobile-first registration (phone-based, no password, no session) ===
router.get('/register', (req, res) => {
  res.render('register', { error: req.query.error || null });
});

router.post('/register', upload.single('photo'), (req, res) => {
  const { name, sport, skill_level, location } = req.body;
  const phone = normPhone(req.body.phone);

  if (!name || !phone || !sport || !skill_level) {
    return res.redirect('/register?error=missing_fields');
  }
  if (!VALID_SPORTS.includes(sport)) {
    return res.redirect('/register?error=invalid_sport');
  }
  if (!VALID_SKILL_LEVELS[sport].includes(skill_level)) {
    return res.redirect('/register?error=invalid_level');
  }

  const season = db.prepare('SELECT * FROM seasons WHERE active = 1').get();
  if (!season) return res.redirect('/register?error=no_active_season');

  const dup = db.prepare(
    'SELECT id FROM players WHERE phone = ? AND season_id = ?'
  ).get(phone, season.id);
  if (dup) return res.redirect('/register?error=phone_taken');

  const photo_path = req.file ? '/uploads/' + req.file.filename : null;

  let rank;
  try {
    const create = db.transaction(() => {
      const maxRank = db.prepare(`
        SELECT MAX(rank) as m FROM players
        WHERE season_id = ? AND sport = ? AND skill_level = ?
      `).get(season.id, sport, skill_level);
      const newRank = (maxRank.m || 0) + 1;
      db.prepare(`
        INSERT INTO players
          (season_id, name, phone, sport, skill_level, location, photo_path, rank)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(season.id, name, phone, sport, skill_level, location || null, photo_path, newRank);
      return newRank;
    });
    rank = create();
  } catch (err) {
    console.error('[auth] mobile register failed', err);
    return res.redirect('/register?error=server_error');
  }

  // Fire-and-forget WhatsApp welcome
  kazi.sendWelcome({ name, phone, sport, skill_level, rank });

  const params = new URLSearchParams({ name, sport, level: skill_level, rank: String(rank) });
  res.redirect('/register/success?' + params.toString());
});

router.get('/register/success', (req, res) => {
  const { name, sport, level, rank } = req.query;
  const kaziWaNumber = (process.env.KAZI_WA_NUMBER || '').replace(/^\+/, '');
  res.render('register-success', { name, sport, level, rank, kaziWaNumber });
});

// === Admin login (email + password) — unchanged from v1.1 ===
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

  const player = db.prepare(
    'SELECT id, name, email, password_hash, sport, skill_level, rank FROM players WHERE email = ? AND season_id = ?'
  ).get(email, season.id);
  // Mobile-registered players have no password_hash and can't log in this way.
  if (!player || !player.password_hash) return res.render('login', { error: 'Invalid email or password', form });

  let valid;
  try { valid = await bcrypt.compare(password, player.password_hash); }
  catch (err) { console.error('[auth] bcrypt compare failed', err); return res.render('login', { error: 'Server error', form }); }
  if (!valid) return res.render('login', { error: 'Invalid email or password', form });

  req.session.userId = player.id;
  req.session.playerName = player.name;
  req.session.userRank = player.rank;
  req.session.email = player.email;
  req.session.sport = player.sport;
  req.session.skillLevel = player.skill_level;
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
router.get('/logout',  (req, res) => req.session.destroy(() => res.redirect('/')));

router.get('/dashboard', requireAuth, requirePaid, (req, res) => {
  const player = db.prepare('SELECT id, name, sport, skill_level, rank, wins, losses FROM players WHERE id = ?').get(req.session.userId);
  if (!player) return req.session.destroy(() => res.redirect('/login'));

  req.session.userRank = player.rank;
  req.session.sport = player.sport;
  req.session.skillLevel = player.skill_level;

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
