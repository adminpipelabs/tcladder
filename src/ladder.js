function recalcRanks(db, seasonId, ntrp, challengerId, opponentId, winnerId) {
  const tx = db.transaction(() => {
    const challenger = db.prepare('SELECT id, rank FROM players WHERE id = ?').get(challengerId);
    const opponent = db.prepare('SELECT id, rank FROM players WHERE id = ?').get(opponentId);

    if (!challenger || !opponent) {
      throw new Error('recalcRanks: player not found');
    }

    const loserId = winnerId === challengerId ? opponentId : challengerId;

    db.prepare('UPDATE players SET wins = wins + 1 WHERE id = ?').run(winnerId);
    db.prepare('UPDATE players SET losses = losses + 1 WHERE id = ?').run(loserId);

    // Rank swap only when challenger wins from below (higher rank number = lower position).
    if (winnerId === challengerId && challenger.rank > opponent.rank) {
      const newRank = opponent.rank;
      const oldRank = challenger.rank;

      db.prepare(`
        UPDATE players SET rank = rank + 1
        WHERE season_id = ? AND ntrp = ? AND paid = 1
          AND rank >= ? AND rank < ?
      `).run(seasonId, ntrp, newRank, oldRank);

      db.prepare('UPDATE players SET rank = ? WHERE id = ?').run(newRank, challengerId);
    }
  });

  tx();
}

module.exports = { recalcRanks };

if (require.main === module) {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE players (
      id INTEGER PRIMARY KEY,
      season_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      ntrp TEXT NOT NULL,
      paid INTEGER NOT NULL DEFAULT 1,
      rank INTEGER,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0
    );
  `);

  const insert = db.prepare(
    `INSERT INTO players (id, season_id, name, ntrp, rank) VALUES (?, 1, ?, '3.5', ?)`
  );
  insert.run(1, 'A', 1);
  insert.run(2, 'B', 2);
  insert.run(3, 'C', 3);
  insert.run(4, 'D', 4);

  const fmt = (rows) =>
    rows.map((r) => `${r.name}=#${r.rank} (${r.wins}W ${r.losses}L)`).join(', ');
  const snap = () =>
    db.prepare('SELECT name, rank, wins, losses FROM players ORDER BY rank').all();

  function check(label, expected) {
    const actual = snap();
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${label}`);
    console.log(`    actual:   ${fmt(actual)}`);
    if (!ok) console.log(`    expected: ${fmt(expected)}`);
    return ok;
  }

  console.log('Initial: ' + fmt(snap()));

  console.log('\nTest 1: D (rank 4) challenges B (rank 2), D wins -> D jumps to #2');
  recalcRanks(db, 1, '3.5', 4, 2, 4);
  const t1 = check('D=#2, B=#3, C=#4 shifted; D.wins=1, B.losses=1', [
    { name: 'A', rank: 1, wins: 0, losses: 0 },
    { name: 'D', rank: 2, wins: 1, losses: 0 },
    { name: 'B', rank: 3, wins: 0, losses: 1 },
    { name: 'C', rank: 4, wins: 0, losses: 0 }
  ]);

  console.log('\nTest 2: D (rank 2) challenges A (rank 1), A wins -> no rank change');
  recalcRanks(db, 1, '3.5', 4, 1, 1);
  const t2 = check('ranks unchanged; A.wins=1, D.losses=1', [
    { name: 'A', rank: 1, wins: 1, losses: 0 },
    { name: 'D', rank: 2, wins: 1, losses: 1 },
    { name: 'B', rank: 3, wins: 0, losses: 1 },
    { name: 'C', rank: 4, wins: 0, losses: 0 }
  ]);

  console.log('\nTest 3: C (rank 4) challenges D (rank 2), C wins -> C jumps to #2');
  recalcRanks(db, 1, '3.5', 3, 4, 3);
  const t3 = check('C=#2, D=#3, B=#4; C.wins=1, D.losses=2', [
    { name: 'A', rank: 1, wins: 1, losses: 0 },
    { name: 'C', rank: 2, wins: 1, losses: 0 },
    { name: 'D', rank: 3, wins: 1, losses: 2 },
    { name: 'B', rank: 4, wins: 0, losses: 1 }
  ]);

  const allPass = t1 && t2 && t3;
  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'TESTS FAILED'));
  process.exit(allPass ? 0 : 1);
}
