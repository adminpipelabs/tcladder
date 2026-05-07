const KAZI_API_URL = process.env.KAZI_API_URL;
const KAZI_API_KEY = process.env.KAZI_API_KEY;

let _warned = false;

async function send(phone, message) {
  if (!KAZI_API_URL || !KAZI_API_KEY) {
    if (!_warned) {
      console.warn('[kazi] KAZI_API_URL/KEY not set — messages will be no-op');
      _warned = true;
    }
    console.log(`[kazi] (no-op) to=${phone}: ${message.slice(0, 80)}...`);
    return;
  }
  if (!phone) {
    console.warn('[kazi] no phone number, skipping send');
    return;
  }
  try {
    const res = await fetch(KAZI_API_URL.replace(/\/$/, '') + '/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + KAZI_API_KEY
      },
      body: JSON.stringify({ to: phone, message })
    });
    if (!res.ok) {
      console.error(`[kazi] HTTP ${res.status} sending to ${phone}`);
    } else {
      console.log(`[kazi] sent to ${phone}: ${message.slice(0, 50)}...`);
    }
  } catch (err) {
    console.error(`[kazi] send failed to ${phone}: ${err.message}`);
  }
}

async function sendWelcome(player) {
  const baseUrl = process.env.BASE_URL || '';
  const msg =
`Hi ${player.name}! You're now on the TCLadder ${player.sport} ${player.skill_level} ladder at rank #${player.rank}.

When someone challenges you, I'll send you a message here with the details.
To challenge someone yourself, visit: ${baseUrl}/ladder/${player.sport}/${player.skill_level}

Reply LADDER to see your division anytime. Good luck! 🎾`;
  await send(player.phone, msg);
}

async function sendChallenge(opponent, challenger, challenge) {
  const baseUrl = process.env.BASE_URL || '';
  const msg =
`Hi ${opponent.name}! ${challenger.name} has challenged you to ${challenger.sport} at ${challenge.proposed_location}.

When: ${challenge.proposed_time}

Reply YES to accept, NO to decline, or COUNTER to suggest another time.
Or tap: ${baseUrl}/challenges/action?token=${challenge.token}&action=accept`;
  await send(opponent.phone, msg);
}

async function sendAccepted(challenger, opponent, challenge) {
  const baseUrl = process.env.BASE_URL || '';
  const time = challenge.counter_time || challenge.proposed_time;
  const location = challenge.counter_location || challenge.proposed_location;
  const msg =
`${opponent.name} accepted your challenge!

When: ${time}
Where: ${location}

Good luck! Report your score after the match at:
${baseUrl}/challenges/report/${challenge.id}`;
  await send(challenger.phone, msg);
}

async function sendDeclined(challenger, opponent) {
  const msg = `${opponent.name} declined your challenge. Try challenging someone else on the ladder!`;
  await send(challenger.phone, msg);
}

async function sendCountered(challenger, opponent, challenge) {
  const baseUrl = process.env.BASE_URL || '';
  const msg =
`${opponent.name} suggested a different time for your match.

New time: ${challenge.counter_time}
New location: ${challenge.counter_location}

Accept or decline: ${baseUrl}/challenges/action?token=${challenge.token}&action=accept`;
  await send(challenger.phone, msg);
}

async function sendScore(winner, loser, score, sport, level) {
  const baseUrl = process.env.BASE_URL || '';
  const winMsg =
`Match recorded! You beat ${loser.name} ${score}. Great win!

Check your updated rank: ${baseUrl}/ladder/${sport}/${level}`;
  const loseMsg =
`Match recorded. ${winner.name} won ${score}.

Keep challenging — view the ladder: ${baseUrl}/ladder/${sport}/${level}`;
  await send(winner.phone, winMsg);
  await send(loser.phone, loseMsg);
}

module.exports = { sendWelcome, sendChallenge, sendAccepted, sendDeclined, sendCountered, sendScore };
