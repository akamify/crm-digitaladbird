const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const compression = require('compression');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const http      = require('http');

const config       = require('./config/env');
const logger       = require('./utils/logger');
const apiRoutes    = require('./routes');
const chatRoutes   = require('./routes/chat');
const errorHandler = require('./middleware/errorHandler');
const meta         = require('./controllers/metaController');

// ── Frontend proxy: forward non-backend requests to the Next.js server ──
// In production the Next.js frontend runs as a separate PM2 process on
// 127.0.0.1:3000 (see ecosystem.config.js / deploy-vps.sh). Nginx normally
// routes `/` → 3000 and `/api` → 4000, but if Nginx is misconfigured or
// the request reaches the backend directly, we still serve the UI by
// forwarding to the Next.js process here.
const FRONTEND_HOST = process.env.FRONTEND_HOST || '127.0.0.1';
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3000;

function isBackendPath(p) {
  return p === '/api' || p.startsWith('/api/')
      || p === '/health' || p.startsWith('/health/')
      || p === '/webhooks' || p.startsWith('/webhooks/')
      || p === '/uploads' || p.startsWith('/uploads/')
      || p === '/socket.io' || p.startsWith('/socket.io/');
}

function frontendOfflinePage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>CRM — Frontend Offline</title></head>`
    + `<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a;padding:48px;max-width:640px;margin:0 auto;line-height:1.55">`
    + `<h1 style="color:#dc2626;margin:0 0 8px">Frontend not running</h1>`
    + `<p style="color:#475569">The Next.js frontend on <code>${FRONTEND_HOST}:${FRONTEND_PORT}</code> is not reachable. The API is still available at <code>/api</code>.</p>`
    + `<pre style="background:#f1f5f9;border-radius:8px;padding:16px;font-size:13px;color:#334155;overflow:auto">pm2 status\npm2 restart crm-frontend\npm2 logs crm-frontend --lines 50</pre>`
    + `<p style="color:#64748b;font-size:13px">If the build is missing: <code>cd /opt/digitaladbird-crm/frontend &amp;&amp; npm install &amp;&amp; npm run build &amp;&amp; pm2 restart crm-frontend</code></p>`
    + `</body></html>`;
}

function proxyToFrontend(req, res) {
  const headers = { ...req.headers };
  headers.host = `${FRONTEND_HOST}:${FRONTEND_PORT}`;
  delete headers['content-length'];

  let body;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && Object.keys(req.body).length > 0) {
    body = JSON.stringify(req.body);
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(body);
  }

  const proxyReq = http.request({
    host: FRONTEND_HOST,
    port: FRONTEND_PORT,
    method: req.method,
    path: req.originalUrl,
    headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (res.headersSent) { try { res.end(); } catch (_) {} return; }
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'EHOSTUNREACH') {
      res.status(503).type('html').send(frontendOfflinePage());
      return;
    }
    res.status(502).type('text').send(`Bad Gateway: ${err.message}`);
  });

  if (body) {
    proxyReq.end(body);
  } else {
    req.pipe(proxyReq).on('error', () => { try { proxyReq.destroy(); } catch (_) {} });
  }
}

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
//
// Two URL paths are mounted to the same handlers so existing Meta App configs
// keep working whichever you used:
//   /webhooks/meta   — original, kept for backwards compatibility
//   /webhook         — the path documented in the Meta admin UI today
// Verify token is read from META_VERIFY_TOKEN in backend/.env.
const META_RAW = [
  express.raw({ type: '*/*', limit: '2mb' }),
  (req, _res, next) => { req.rawBody = req.body; next(); },
];
app.get ('/webhooks/meta', meta.verify);
app.post('/webhooks/meta', ...META_RAW, meta.receive);
app.get ('/webhook',       meta.verify);
app.post('/webhook',       ...META_RAW, meta.receive);

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
// Stricter health probe — fails if backend has silently fallen back to the
// in-memory pg-mem fallback. Used by deploy verification + tells dev that
// every query is going to fail with "relation does not exist" before they
// waste 20 minutes debugging it.
app.get('/health/db-strict', async (_req, res) => {
  try {
    const { query } = require('./config/database');
    const { rows } = await query(`SELECT count(*)::int AS n FROM users WHERE deleted_at IS NULL`);
    res.json({ ok: true, real_pg: true, users: rows[0].n });
  } catch (err) {
    res.status(503).json({
      ok: false,
      real_pg: false,
      error: err.message,
      hint: 'Backend likely fell back to in-memory pg-mem. Start real Postgres (node backend/start-db.mjs) and restart backend.'
    });
  }
});

app.use('/api', apiRoutes);
app.use('/api/chat', chatRoutes);

// Final routing: backend prefixes that fell through return JSON 404;
// everything else is forwarded to the Next.js frontend.
app.use((req, res, next) => {
  if (isBackendPath(req.path)) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
  }
  return proxyToFrontend(req, res);
});
app.use(errorHandler);

module.exports = app;
