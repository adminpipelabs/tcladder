const express = require('express');
const session = require('express-session');
const path = require('path');

require('./db');
const paymentsRouter = require('./routes/payments');

const app = express();
app.disable('x-powered-by');

app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, 'public')));

// Stripe webhook MUST come before express.json() — signature verification needs the raw body.
app.post('/pay/webhook', express.raw({ type: 'application/json' }), paymentsRouter.handleWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (!process.env.SESSION_SECRET) {
  console.warn('[app] SESSION_SECRET not set — using insecure fallback (not safe in production)');
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-fallback-do-not-use-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
  }
}));

app.use((req, res, next) => {
  res.locals.session = req.session || {};
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(require('./routes/ladder'));
app.use(require('./routes/auth'));
app.use('/challenges', require('./routes/challenges'));
app.use(paymentsRouter);
app.use(require('./routes/admin'));

app.use((err, req, res, next) => {
  console.error('[error]', err.stack || err);
  if (res.headersSent) return next(err);
  res.status(500).send('Server error');
});

const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log(`[tcladdr] listening on port ${PORT}`);
});
