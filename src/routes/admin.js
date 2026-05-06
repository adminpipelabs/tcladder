const express = require('express');
const router = express.Router();
const db = require('../db');
const { recalcRanks } = require('../ladder');
const { requireAdmin } = require('../middleware');

const VALID_SPORTS = ['tennis', 'padel', 'pickleball'];

router.use(requireAdmin);

function getActiveSeason() {
  return db.prepare('SELECT * FROM seasons WHERE active = 1').get();
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

router.get('/admin', (req, res) => {
  const season = getActiveSeason();
  if (!season) return res.status(503).send('No active season');

  const sportFilter = req.query.sport;
  const filterValid = sportFilter && VALID_SPORTS.includes(sportFilter);

  const players = filterValid
    ? db.prepare(`
        SELECT id, name, email, phone, sport, skill_level, rank, wins, losses, paid, created_at
        FROM players WHERE season_id = ? AND sport = ?
        ORDER BY skill_level, rank
      `).all(season.id, sportFilter)
    : db.prepare(`
        SELECT id, name, email, phone, sport, skill_level, rank, wins, losses, paid, created_at
        FROM players WHERE season_id = ?
        ORDER BY sport, skill_level, rank
      `).all(season.id);

  res.render('admin', {
    title: 'Admin',
    currentNav: null,
    session: req.session,
    season,
    players,
    sportFilter: filterValid ? sportFilter : null
  });
});

router.post('/admin/verify-payment', (req, res) => {
  const playerId = parseInt(req.body.player_id, 10);
  if (!Number.isInteger(playerId)) return res.status(400).send('Invalid player id');

  const result = db.prepare('UPDATE players SET paid = 1 WHERE id = ?').run(playerId);
  if (result.changes === 0) return res.status(404).send('Player not found');

  res.redirect('/admin');
});

router.post('/admin/remove-player', (req, res) => {
  const playerId = parseInt(req.body.player_id, 10);
  if (!Number.isInteger(playerId)) return res.status(400).send('Invalid player id');

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM challenges WHERE challenger_id = ? OR opponent_id = ? OR winner_id = ?')
      .run(playerId, playerId, playerId);
    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
  });
  tx();

  res.redirect('/admin');
});

router.post('/admin/override-score', (req, res) => {
  const challengeId = parseInt(req.body.challenge_id, 10);
  const winnerId = parseInt(req.body.winner_id, 10);
  const score = (req.body.score || '').trim();
  if (!Number.isInteger(challengeId) || !Number.isInteger(winnerId) || !score) {
    return res.status(400).send('Missing required fields');
  }

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
  if (!challenge) return res.status(404).send('Challenge not found');
  if (challenge.status !== 'completed' && challenge.status !== 'accepted') {
    return res.status(410).send('Challenge is ' + challenge.status + ', cannot override');
  }
  if (winnerId !== challenge.challenger_id && winnerId !== challenge.opponent_id) {
    return res.status(400).send('Winner must be one of the players');
  }

  const challenger = db.prepare('SELECT id, sport, skill_level FROM players WHERE id = ?').get(challenge.challenger_id);
  if (!challenger) return res.status(500).send('Challenger not found');

  const tx = db.transaction(() => {
    if (challenge.status === 'completed' && challenge.winner_id) {
      const oldWinner = challenge.winner_id;
      const oldLoser = challenge.challenger_id === oldWinner ? challenge.opponent_id : challenge.challenger_id;
      db.prepare('UPDATE players SET wins = wins - 1 WHERE id = ?').run(oldWinner);
      db.prepare('UPDATE players SET losses = losses - 1 WHERE id = ?').run(oldLoser);
    }

    db.prepare(`
      UPDATE challenges SET status='completed', winner_id=?, score=?, updated_at=datetime('now')
      WHERE id=?
    `).run(winnerId, score, challengeId);

    recalcRanks(db, challenge.season_id, challenger.sport, challenger.skill_level,
      challenge.challenger_id, challenge.opponent_id, winnerId);
  });

  try { tx(); }
  catch (err) {
    console.error('[admin] override-score failed', err);
    return res.status(500).send('Failed to override');
  }

  res.redirect('/admin');
});

router.get('/admin/export', (req, res) => {
  const season = getActiveSeason();
  if (!season) return res.status(503).send('No active season');

  const players = db.prepare(`
    SELECT name, email, phone, sport, skill_level, rank, wins, losses, paid, created_at
    FROM players WHERE season_id = ?
    ORDER BY sport, skill_level, rank
  `).all(season.id);

  const headers = ['name', 'email', 'phone', 'sport', 'skill_level', 'rank', 'wins', 'losses', 'paid', 'created_at'];
  const lines = [headers.join(',')];
  for (const p of players) {
    lines.push(headers.map(h => csvEscape(p[h])).join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=tcladdr-players.csv');
  res.send(lines.join('\n') + '\n');
});

module.exports = router;
