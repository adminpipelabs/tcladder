const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/tcladdr.db';

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    fee_cents INTEGER NOT NULL DEFAULT 3000,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER REFERENCES seasons(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    phone TEXT,
    ntrp TEXT NOT NULL CHECK(ntrp IN ('3.0','3.5','4.0','4.5+')),
    location TEXT,
    paid INTEGER NOT NULL DEFAULT 0,
    stripe_session_id TEXT,
    rank INTEGER,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(email, season_id)
  );

  CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER REFERENCES seasons(id),
    challenger_id INTEGER NOT NULL REFERENCES players(id),
    opponent_id INTEGER NOT NULL REFERENCES players(id),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','accepted','countered','declined','completed')),
    proposed_time TEXT NOT NULL,
    proposed_location TEXT NOT NULL,
    counter_time TEXT,
    counter_location TEXT,
    winner_id INTEGER REFERENCES players(id),
    score TEXT,
    token TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Idempotent season seed: only inserts when no active season exists.
// Safe to run on every container startup.
const existing = db.prepare('SELECT id FROM seasons WHERE active = 1').get();
if (!existing) {
  const { SEASON_NAME, SEASON_START, SEASON_END } = process.env;
  if (SEASON_NAME && SEASON_START && SEASON_END) {
    db.prepare(
      'INSERT INTO seasons (name, start_date, end_date, active) VALUES (?, ?, ?, 1)'
    ).run(SEASON_NAME, SEASON_START, SEASON_END);
    console.log(`[db] seeded active season: ${SEASON_NAME} (${SEASON_START} -> ${SEASON_END})`);
  } else {
    console.warn('[db] no active season exists and SEASON_NAME/START/END env vars not set');
  }
}

module.exports = db;
