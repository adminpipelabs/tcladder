const express = require('express');
const router = express.Router();
const db = require('../db');

const VALID_NTRP = ['3.0', '3.5', '4.0', '4.5+'];
const PREVIEW_DIVISION = '3.5';

function getActiveSeason() {
  return db.prepare('SELECT * FROM seasons WHERE active = 1').get();
}

router.get('/', (req, res) => {
  const season = getActiveSeason();

  let totalPlayers = 0;
  let topPlayers = [];

  if (season) {
    totalPlayers = db.prepare(
      'SELECT COUNT(*) as c FROM players WHERE season_id = ? AND paid = 1'
    ).get(season.id).c;

    topPlayers = db.prepare(`
      SELECT id, name, rank, wins, losses, ntrp, location
      FROM players
      WHERE season_id = ? AND ntrp = ? AND paid = 1
      ORDER BY rank ASC
      LIMIT 5
    `).all(season.id, PREVIEW_DIVISION);
  }

  res.render('index', {
    title: 'Home',
    currentNav: 'home',
    season,
    totalPlayers,
    topPlayers,
    previewDivision: PREVIEW_DIVISION
  });
});

router.get('/ladder', (req, res) => {
  res.redirect('/ladder/3.5');
});

router.get('/ladder/:division', (req, res) => {
  const division = req.params.division;

  if (!VALID_NTRP.includes(division)) {
    return res.status(404).send('Invalid division');
  }

  const season = getActiveSeason();
  let players = [];

  if (season) {
    players = db.prepare(`
      SELECT id, name, rank, wins, losses, location
      FROM players
      WHERE season_id = ? AND ntrp = ? AND paid = 1
      ORDER BY rank ASC
    `).all(season.id, division);
  }

  res.render('ladder', {
    title: `Ladder · ${division}`,
    currentNav: 'ladder',
    season,
    division,
    divisions: VALID_NTRP,
    players
  });
});

module.exports = router;
