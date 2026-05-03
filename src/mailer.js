let _state = null;

function getTransporter() {
  if (_state !== null) return _state.transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.warn('[mailer] SMTP_HOST/PORT/USER/PASS not fully set — emails will be no-op');
    _state = { transporter: null };
    return null;
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: String(SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  _state = { transporter };
  return transporter;
}

async function send(to, subject, text) {
  const t = getTransporter();
  if (!t) return;

  const from = process.env.MAIL_FROM || 'TCLadder <no-reply@tcladdr.com>';

  try {
    const info = await t.sendMail({ from, to, subject, text });
    console.log(`[mailer] sent to ${to}: "${subject}" (id=${info.messageId})`);
  } catch (err) {
    console.error(`[mailer] failed to send to ${to}: "${subject}" — ${err.message}`);
  }
}

function actionLink(token, action) {
  const baseUrl = process.env.BASE_URL || '';
  return `${baseUrl}/challenges/action?token=${token}&action=${action}`;
}

async function sendWelcome(player) {
  const baseUrl = process.env.BASE_URL || '';
  const seasonName = process.env.SEASON_NAME || 'TCLadder';
  await send(
    player.email,
    `Welcome to TCLadder ${seasonName}`,
    `Hi ${player.name},\n\n` +
    `Welcome to TCLadder ${seasonName}! Your registration is confirmed.\n\n` +
    `Log in: ${baseUrl}/login\n\n` +
    `— TCLadder`
  );
}

async function sendChallenge(opponent, challenger, challenge) {
  await send(
    opponent.email,
    `You've been challenged by ${challenger.name}`,
    `Hi ${opponent.name},\n\n` +
    `You've been challenged by ${challenger.name}.\n\n` +
    `Proposed: ${challenge.proposed_time} at ${challenge.proposed_location}\n\n` +
    `Choose one:\n` +
    `Accept:  ${actionLink(challenge.token, 'accept')}\n` +
    `Counter: ${actionLink(challenge.token, 'counter')}\n` +
    `Decline: ${actionLink(challenge.token, 'decline')}\n\n` +
    `— TCLadder`
  );
}

async function sendAccepted(challenger, opponent, challenge) {
  const time = challenge.counter_time || challenge.proposed_time;
  const location = challenge.counter_location || challenge.proposed_location;
  await send(
    challenger.email,
    `${opponent.name} accepted your challenge`,
    `Hi ${challenger.name},\n\n` +
    `${opponent.name} accepted your challenge.\n\n` +
    `See you ${time} at ${location}.\n\n` +
    `— TCLadder`
  );
}

async function sendCountered(challenger, opponent, challenge) {
  await send(
    challenger.email,
    `${opponent.name} proposed a different time/location`,
    `Hi ${challenger.name},\n\n` +
    `${opponent.name} proposed a different time/location:\n\n` +
    `Time: ${challenge.counter_time}\n` +
    `Location: ${challenge.counter_location}\n\n` +
    `Accept:  ${actionLink(challenge.token, 'accept')}\n` +
    `Decline: ${actionLink(challenge.token, 'decline')}\n\n` +
    `— TCLadder`
  );
}

async function sendDeclined(challenger, opponent) {
  await send(
    challenger.email,
    `${opponent.name} declined your challenge`,
    `Hi ${challenger.name},\n\n` +
    `${opponent.name} declined your challenge. Try challenging someone else.\n\n` +
    `— TCLadder`
  );
}

async function sendScore(winner, loser, score) {
  const baseUrl = process.env.BASE_URL || '';
  const subject = `Match result: ${winner.name} def. ${loser.name} ${score}`;
  const body = (recipient) =>
    `Hi ${recipient.name},\n\n` +
    `Match result recorded: ${winner.name} def. ${loser.name} ${score}. Ladder updated.\n\n` +
    `Dashboard: ${baseUrl}/dashboard\n\n` +
    `— TCLadder`;

  await send(winner.email, subject, body(winner));
  await send(loser.email, subject, body(loser));
}

module.exports = { sendWelcome, sendChallenge, sendAccepted, sendCountered, sendDeclined, sendScore };
