const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const compression = require('compression');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

const config       = require('./config/env');
const logger       = require('./utils/logger');
const apiRoutes    = require('./routes');
const chatRoutes   = require('./routes/chat');
const errorHandler = require('./middleware/errorHandler');
const meta         = require('./controllers/metaController');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (config.cors.origins.includes(origin) || config.cors.origins.includes('*')) return cb(null, true);
    cb(new Error('CORS blocked'));
  },
  credentials: true,
}));
app.use(morgan('tiny', { stream: { write: m => logger.info(m.trim()) } }));

// rate limiting (per-IP); auth endpoints have an extra tighter limit
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many auth attempts' } },
});
app.use('/api', generalLimiter);
app.use('/api/auth', authLimiter);

// Meta webhook MUST use the raw body so we can verify the HMAC signature.
app.get ('/webhooks/meta', meta.verify);
app.post(
  '/webhooks/meta',
  express.raw({ type: '*/*', limit: '2mb' }),
  (req, _res, next) => { req.rawBody = req.body; next(); },
  meta.receive
);

// Serve uploaded chat files
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Everything else uses JSON body parser.
app.use(express.json({ limit: '10mb' }));

app.get('/health',         (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.get('/health/db',      async (_req, res) => {
  try {
    const { query } = require('./config/database');
    const { rows } = await query(`SELECT NOW() AS now`);
    res.json({ ok: true, db: rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use('/api', apiRoutes);
app.use('/api/chat', chatRoutes);

app.use((req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } }));
app.use(errorHandler);

module.exports = app;
