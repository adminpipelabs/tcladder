const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const mailer = require('../mailer');
const { recalcRanks } = require('../ladder');
const { requireAuth, requirePaid } = require('../middleware');

const VALID_ACTIONS = ['accept', 'counter', 'decline'];

function getActiveSeason() {
  return db.prepare('SELECT * FROM seasons WHERE active = 1').get();
}

router.get('/new/:opponentId', requireAuth, requirePaid, (req, res) => {
  const opponentId = parseInt(req.params.opponentId, 10);
  if (!Number.isInteger(opponentId)) return res.status(400).send('Invalid opponent id');

  const season = getActiveSeason();
  if (!season) return res.status(503).send('No active season');

  const opponent = db.prepare('SELECT id, name, ntrp, rank FROM players WHERE id = ?').get(opponentId);
  if (!opponent || opponent.id === req.session.userId) {
    return res.status(404).send('Opponent not found');
  }

  const challenger = db.prepare('SELECT id, ntrp, rank FROM players WHERE id = ?').get(req.session.userId);
  if (!challenger) {
    return req.session.destroy(() => res.redirect('/login'));
  }

  if (opponent.ntrp !== challenger.ntrp) {
    return res.status(400).send('Cannot challenge across NTRP divisions');
  }
  const rankGap = challenger.rank - opponent.rank;
  if (rankGap < 1 || rankGap > 3) {
    return res.status(400).send('Can only challenge players ranked 1-3 positions above you');
  }

  res.render('challenge-new', {
    title: 'New challenge',
    currentNav: 'dashboard',
    session: req.session,
    opponent,
    error: null,
    form: {}
  });
});

router.post('/new', requireAuth, requirePaid, (req, res) => {
  const { opponent_id, proposed_time, proposed_location } = req.body;
  const opponentId = parseInt(opponent_id, 10);
  if (!Number.isInteger(opponentId) || !proposed_time || !proposed_location) {
    return res.status(400).send('Missing required fields');
  }

  const season = getActiveSeason();
  if (!season) return res.status(503).send('No active season');

  const opponent = db.prepare('SELECT id, name, email, ntrp, rank FROM players WHERE id = ?').get(opponentId);
  if (!opponent || opponent.id === req.session.userId) return res.status(404).send('Opponent not found');

  const challenger = db.prepare('SELECT id, name, email, ntrp, rank FROM players WHERE id = ?').get(req.session.userId);
  if (!challenger || opponent.ntrp !== challenger.ntrp) {
    return res.status(400).send('Cannot challenge across NTRP divisions');
  }
  const rankGap = challenger.rank - opponent.rank;
  if (rankGap < 1 || rankGap > 3) {
    return res.status(400).send('Can only challenge players ranked 1-3 positions above you');
  }

  const token = crypto.randomBytes(32).toString('hex');

  const result = db.prepare(`
    INSERT INTO challenges (season_id, challenger_id, opponent_id, status, proposed_time, proposed_location, token)
    VALUES (?, ?, ?, 'pending', ?, ?, ?)
  `).run(season.id, challenger.id, opponent.id, proposed_time, proposed_location, token);

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(result.lastInsertRowid);

  mailer.sendChallenge(opponent, challenger, challenge);

  res.redirect('/dashboard');
});

router.get('/action', (req, res) => {
  const { token, action } = req.query;
  if (!token || !VALID_ACTIONS.includes(action)) return res.status(400).send('Invalid request');

  const challenge = db.prepare('SELECT * FROM challenges WHERE token = ?').get(token);
  if (!challenge) return res.status(404).send('Challenge not found or already processed');
  if (challenge.status !== 'pending' && challenge.status !== 'countered') {
    return res.status(410).send(`This challenge is already ${challenge.status}`);
  }
  if (challenge.status === 'countered' && action === 'counter') {
    return res.status(400).send('Cannot counter a counter');
  }

  const challenger = db.prepare('SELECT id, name, email FROM players WHERE id = ?').get(challenge.challenger_id);
  const opponent = db.prepare('SELECT id, name, email FROM players WHERE id = ?').get(challenge.opponent_id);

  res.render('challenge-view', {
    title: 'Challenge',
    currentNav: null,
    session: req.session,
    challenge, challenger, opponent, action
  });
});

router.post('/action', (req, res) => {
  const { token, action, counter_time, counter_location } = req.body;
  if (!token || !VALID_ACTIONS.includes(action)) return res.status(400).send('Invalid request');

  const challenge = db.prepare('SELECT * FROM challenges WHERE token = ?').get(token);
  if (!challenge) return res.status(404).send('Challenge not found or already processed');
  if (challenge.status !== 'pending' && challenge.status !== 'countered') {
    return res.status(410).send(`This challenge is already ${challenge.status}`);
  }
  if (challenge.status === 'countered' && action === 'counter') {
    return res.status(400).send('Cannot counter a counter');
  }

  const challenger = db.prepare('SELECT id, name, email FROM players WHERE id = ?').get(challenge.challenger_id);
  const opponent = db.prepare('SELECT id, name, email FROM players WHERE id = ?').get(challenge.opponent_id);
  const wasCountered = challenge.status === 'countered';

  if (action === 'accept') {
    db.prepare(`UPDATE challenges SET status='accepted', updated_at=datetime('now') WHERE id=?`).run(challenge.id);
    const updated = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challenge.id);
    // pending->accepted: opponent acted, notify challenger.
    // countered->accepted: challenger acted, notify opponent (args reversed).
    if (wasCountered) mailer.sendAccepted(opponent, challenger, updated);
    else mailer.sendAccepted(challenger, opponent, updated);
  } else if (action === 'decline') {
    db.prepare(`UPDATE challenges SET status='declined', updated_at=datetime('now') WHERE id=?`).run(challenge.id);
    if (wasCountered) mailer.sendDeclined(opponent, challenger);
    else mailer.sendDeclined(challenger, opponent);
  } else if (action === 'counter') {
    if (!counter_time || !counter_location) return res.status(400).send('Counter requires time and location');
    const newToken = crypto.randomBytes(32).toString('hex');
    db.prepare(`
      UPDATE challenges
      SET status='countered', counter_time=?, counter_location=?, token=?, updated_at=datetime('now')
      WHERE id=?
    `).run(counter_time, counter_location, newToken, challenge.id);
    const updated = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challenge.id);
    mailer.sendCountered(challenger, opponent, updated);
  }

  res.send('Thanks - your response has been recorded. You can close this tab.');
});

router.get('/report/:id', requireAuth, requirePaid, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).send('Invalid challenge id');

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
  if (!challenge) return res.status(404).send('Challenge not found');
  if (challenge.status !== 'accepted') {
    return res.status(410).send(`This match is ${challenge.status}, cannot report score`);
  }
  if (challenge.challenger_id !== req.session.userId && challenge.opponent_id !== req.session.userId) {
    return res.status(403).send('You are not part of this match');
  }

  const challenger = db.prepare('SELECT id, name FROM players WHERE id = ?').get(challenge.challenger_id);
  const opponent = db.prepare('SELECT id, name FROM players WHERE id = ?').get(challenge.opponent_id);

  res.render('score-report', {
    title: 'Report score',
    currentNav: 'dashboard',
    session: req.session,
    challenge, challenger, opponent,
    error: null
  });
});

router.post('/report', requireAuth, requirePaid, (req, res) => {
  const challengeId = parseInt(req.body.challenge_id, 10);
  const winnerId = parseInt(req.body.winner_id, 10);
  const score = (req.body.score || '').trim();
  if (!Number.isInteger(challengeId) || !Number.isInteger(winnerId) || !score) {
    return res.status(400).send('Missing required fields');
  }

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
  if (!challenge) return res.status(404).send('Challenge not found');
  if (challenge.status !== 'accepted') {
    return res.status(410).send(`This match is ${challenge.status}, cannot report score`);
  }
  if (challenge.challenger_id !== req.session.userId && challenge.opponent_id !== req.session.userId) {
    return res.status(403).send('You are not part of this match');
  }
  if (winnerId !== challenge.challenger_id && winnerId !== challenge.opponent_id) {
    return res.status(400).send('Winner must be one of the players');
  }

  const challenger = db.prepare('SELECT id, name, email, ntrp FROM players WHERE id = ?').get(challenge.challenger_id);
  const opponent = db.prepare('SELECT id, name, email, ntrp FROM players WHERE id = ?').get(challenge.opponent_id);
  const ntrp = challenger.ntrp;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE challenges SET status='completed', winner_id=?, score=?, updated_at=datetime('now')
      WHERE id=?
    `).run(winnerId, score, challengeId);
    recalcRanks(db, challenge.season_id, ntrp, challenge.challenger_id, challenge.opponent_id, winnerId);
  });

  try { tx(); }
  catch (err) {
    console.error('[challenges] report failed', err);
    return res.status(500).send('Failed to record score');
  }

  const winner = winnerId === challenger.id ? challenger : opponent;
  const loser  = winnerId === challenger.id ? opponent  : challenger;
  mailer.sendScore(winner, loser, score);

  res.redirect(`/ladder/${ntrp}`);
});

module.exports = router;
