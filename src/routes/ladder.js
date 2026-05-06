const express = require('express');
const router = express.Router();
const db = require('../db');

const VALID_SPORTS = ['tennis', 'padel', 'pickleball'];
const VALID_LEVELS = {
  tennis: ['3.0', '3.5', '4.0', '4.5+'],
  padel: ['beginner', 'intermediate', 'advanced', 'competitive'],
  pickleball: ['beginner', 'intermediate', 'advanced', 'competitive']
};
const PREVIEW_SPORT = 'tennis';
const PREVIEW_LEVEL = '3.5';

function getActiveSeason() {
  return db.prepare('SELECT * FROM seasons WHERE active = 1').get();
}

router.get('/', (req, res) => {
  const season = getActiveSeason();

  const counts = { tennis: 0, padel: 0, pickleball: 0 };
  let topPlayers = [];

  if (season) {
    for (const s of VALID_SPORTS) {
      counts[s] = db.prepare(
        'SELECT COUNT(*) as c FROM players WHERE season_id = ? AND sport = ? AND paid = 1'
      ).get(season.id, s).c;
    }
    topPlayers = db.prepare(`
      SELECT id, name, rank, wins, losses, sport, skill_level, location
      FROM players
      WHERE season_id = ? AND sport = ? AND skill_level = ? AND paid = 1
      ORDER BY rank ASC
      LIMIT 5
    `).all(season.id, PREVIEW_SPORT, PREVIEW_LEVEL);
  }

  res.render('index', {
    title: 'Home',
    currentNav: 'home',
    season,
    counts,
    topPlayers,
    previewSport: PREVIEW_SPORT,
    previewLevel: PREVIEW_LEVEL
  });
});

router.get('/ladder', (req, res) => {
  res.redirect('/ladder/tennis/3.5');
});

router.get('/ladder/:sport/:level', (req, res) => {
  const { sport, level } = req.params;

  if (!VALID_SPORTS.includes(sport)) {
    return res.status(404).send('Invalid sport');
  }
  if (!VALID_LEVELS[sport].includes(level)) {
    return res.status(404).send('Invalid skill level for this sport');
  }

  const season = getActiveSeason();
  let players = [];

  if (season) {
    players = db.prepare(`
      SELECT id, name, rank, wins, losses, location
      FROM players
      WHERE season_id = ? AND sport = ? AND skill_level = ? AND paid = 1
      ORDER BY rank ASC
    `).all(season.id, sport, level);
  }

  res.render('ladder', {
    title: 'Ladder ' + sport + ' ' + level,
    currentNav: 'ladder',
    season,
    sport,
    level,
    sports: VALID_SPORTS,
    validLevels: VALID_LEVELS[sport],
    players
  });
});

module.exports = router;
