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
    sport TEXT NOT NULL DEFAULT 'tennis' CHECK(sport IN ('tennis','padel','pickleball')),
    skill_level TEXT NOT NULL CHECK(skill_level IN (
      '3.0','3.5','4.0','4.5+',
      'beginner','intermediate','advanced','competitive'
    )),
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

function runMigrations() {
  db.prepare(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    run_at TEXT DEFAULT (datetime('now'))
  )`).run();

  const ran = new Set(
    db.prepare('SELECT name FROM migrations').all().map(r => r.name)
  );

  const migrations = [
    {
      name: 'add_sport_to_players',
      up: () => db.prepare(`ALTER TABLE players ADD COLUMN sport TEXT NOT NULL DEFAULT 'tennis'`).run()
    },
    {
      name: 'rename_ntrp_to_skill_level',
      up: () => db.prepare(`ALTER TABLE players RENAME COLUMN ntrp TO skill_level`).run()
    },
    {
      // SQLite cannot ALTER a CHECK constraint in place. After the column rename
      // the original 'ntrp IN (3.0,3.5,4.0,4.5+)' CHECK becomes
      // 'skill_level IN (3.0,3.5,4.0,4.5+)' — which would block padel/pickleball
      // values. Rebuild the table with the expanded CHECK per SQLite docs.
      name: 'expand_skill_level_check',
      up: () => {
        db.pragma('foreign_keys = OFF');
        const tx = db.transaction(() => {
          db.exec(`
            CREATE TABLE players_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              season_id INTEGER REFERENCES seasons(id),
              name TEXT NOT NULL,
              email TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              phone TEXT,
              sport TEXT NOT NULL DEFAULT 'tennis' CHECK(sport IN ('tennis','padel','pickleball')),
              skill_level TEXT NOT NULL CHECK(skill_level IN (
                '3.0','3.5','4.0','4.5+',
                'beginner','intermediate','advanced','competitive'
              )),
              location TEXT,
              paid INTEGER NOT NULL DEFAULT 0,
              stripe_session_id TEXT,
              rank INTEGER,
              wins INTEGER NOT NULL DEFAULT 0,
              losses INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE(email, season_id)
            );
            INSERT INTO players_new (
              id, season_id, name, email, password_hash, phone,
              sport, skill_level, location, paid, stripe_session_id,
              rank, wins, losses, created_at
            )
            SELECT
              id, season_id, name, email, password_hash, phone,
              sport, skill_level, location, paid, stripe_session_id,
              rank, wins, losses, created_at
            FROM players;
            DROP TABLE players;
            ALTER TABLE players_new RENAME TO players;
          `);
        });
        tx();
        db.pragma('foreign_keys = ON');
      }
    }
  ];

  for (const m of migrations) {
    if (ran.has(m.name)) continue;
    try {
      m.up();
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(m.name);
      console.log(`[db] migration: ${m.name}`);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('duplicate column') ||
          msg.includes('already exists') ||
          msg.includes('no such column')) {
        db.prepare('INSERT OR IGNORE INTO migrations (name) VALUES (?)').run(m.name);
        console.log(`[db] migration: ${m.name} (already applied)`);
      } else {
        throw e;
      }
    }
  }
}

runMigrations();

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
