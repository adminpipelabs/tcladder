const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware');

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not set');
    _stripe = require('stripe')(key);
  }
  return _stripe;
}

router.get('/pay', requireAuth, async (req, res, next) => {
  try {
    const player = db.prepare('SELECT id, paid FROM players WHERE id = ?')
      .get(req.session.userId);
    if (!player) return res.redirect('/login');
    if (player.paid === 1) return res.redirect('/dashboard');

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${baseUrl}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pay/cancel`,
      customer_email: req.session.email,
      metadata: { player_id: String(req.session.userId) }
    });

    res.redirect(303, session.url);
  } catch (err) {
    console.error('[payments] checkout session create failed', err);
    next(err);
  }
});

router.get('/pay/success', requireAuth, async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) {
    return res.render('pay-success', { sessionId: null });
  }

  let stripeSession;
  try {
    stripeSession = await getStripe().checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error('[payments] failed to retrieve checkout session:', err.message);
    return res.status(400).send('Invalid session');
  }

  const ownerId = stripeSession.metadata && stripeSession.metadata.player_id;
  if (ownerId !== String(req.session.userId)) {
    console.warn(`[payments] /pay/success ownership mismatch: metadata.player_id=${ownerId} vs session.userId=${req.session.userId}`);
    return res.status(400).send('Session does not belong to current user');
  }

  db.prepare('UPDATE players SET stripe_session_id = ? WHERE id = ?')
    .run(sessionId, req.session.userId);

  res.render('pay-success', { sessionId });
});

router.get('/pay/cancel', requireAuth, (req, res) => {
  res.render('pay-cancel');
});

async function handleWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    console.error('[payments] webhook missing signature header or secret');
    return res.status(400).send('Webhook config error');
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[payments] webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const result = db.prepare('UPDATE players SET paid = 1 WHERE stripe_session_id = ?')
      .run(session.id);

    if (result.changes === 0) {
      const playerId = session.metadata && session.metadata.player_id;
      if (playerId) {
        db.prepare('UPDATE players SET paid = 1, stripe_session_id = ? WHERE id = ?')
          .run(session.id, playerId);
        console.log(`[payments] paid=1 set via metadata.player_id=${playerId} (session ${session.id})`);
      } else {
        console.warn(`[payments] checkout.session.completed for ${session.id} — no matching player and no metadata`);
      }
    } else {
      console.log(`[payments] paid=1 set for session ${session.id}`);
    }
  } else {
    console.log(`[payments] ignoring event type: ${event.type}`);
  }

  res.json({ received: true });
}

router.handleWebhook = handleWebhook;
module.exports = router;
