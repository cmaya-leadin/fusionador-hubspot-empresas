import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './db.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import mergeRoutes from './routes/merge.js';
import propertiesRoutes from './routes/properties.js';
import adminRoutes from './routes/admin.js';
import logRoutes from './routes/logs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || process.env.MERGE_PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const INSECURE_SECRETS = new Set([
  'fusionador-dev-secret-change-me',
  'fusionador-cambiar-secreto-en-portainer',
  'cambia-este-secreto-en-produccion',
]);

const sessionSecret = process.env.SESSION_SECRET || 'fusionador-dev-secret-change-me';

/**
 * @returns {boolean | 'auto'}
 */
function resolveSessionCookieSecure() {
  const raw = (process.env.SESSION_COOKIE_SECURE || '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'auto') return 'auto';
  // Detrás de reverse proxy HTTPS: detectar vía X-Forwarded-Proto
  if (process.env.TRUST_PROXY === 'true') return 'auto';
  return false;
}

const app = express();
const trustProxy = process.env.TRUST_PROXY === 'true';

if (trustProxy) {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: resolveSessionCookieSecure(),
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/merge', mergeRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/logs', logRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    secure: req.secure,
    forwardedProto: req.headers['x-forwarded-proto'] || null,
    trustProxy,
    cookieSecure: resolveSessionCookieSecure(),
  });
});

app.use(express.static(PUBLIC_DIR));

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[server] Error:', err);
  res.status(500).json({
    error: err instanceof Error ? err.message : String(err),
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Fusionador HubSpot escuchando en http://${HOST}:${PORT}`);
  console.log('Usuario por defecto: admin / (ver ADMIN_PASSWORD en .env)');
  if (process.env.NODE_ENV === 'production' && INSECURE_SECRETS.has(sessionSecret)) {
    console.warn(
      '[AVISO] SESSION_SECRET por defecto o inseguro. Define SESSION_SECRET en Portainer y redeploy.',
    );
  }
});
