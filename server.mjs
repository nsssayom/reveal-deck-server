import 'dotenv/config';

import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { createHash, timingSafeEqual } from 'crypto';
import { readFile, readdir, stat } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const DECKS_DIR = resolve(
  process.env.DECKS_DIR
    ? (process.env.DECKS_DIR.startsWith('/')
        ? process.env.DECKS_DIR
        : join(process.cwd(), process.env.DECKS_DIR))
    : join(__dirname, 'decks')
);

const SECRET = (process.env.DECK_SECRET ?? '').trim();
const SECRET_REQUIRED = SECRET.length > 0;
const SECRET_HASH_BUF = SECRET_REQUIRED
  ? Buffer.from(createHash('sha256').update(SECRET).digest('hex'), 'utf8')
  : null;

const INJECT_TEMPLATE = (deckId) => `
<script>window.__MULTIPLEX__ = ${JSON.stringify({ deckId })};</script>
<script src="/socket.io/socket.io.js"></script>
<script src="/multiplex.js"></script>
`;

async function listDecks() {
  const entries = await readdir(DECKS_DIR, { withFileTypes: true });
  const decks = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    try {
      await stat(join(DECKS_DIR, e.name, 'index.html'));
      decks.push(e.name);
    } catch {}
  }
  return decks.sort();
}

const app = express();

app.get('/api/decks', async (_req, res) => {
  try {
    res.json(await listDecks());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({ secretRequired: SECRET_REQUIRED });
});

// Standalone speaker view. Master page for driving a deck.
app.get('/speaker/:deck', async (req, res) => {
  const deck = req.params.deck;
  try {
    await stat(join(DECKS_DIR, deck, 'index.html'));
  } catch {
    return res.status(404).type('text/plain').send('Deck not found.');
  }
  res.sendFile(join(__dirname, 'public', 'speaker.html'));
});

// Serve each deck's index.html with the multiplex bootstrap injected.
// Catches both /decks/<name> and /decks/<name>/ and /decks/<name>/index.html.
app.get(/^\/decks\/([^/]+)\/?(?:index\.html)?$/, async (req, res, next) => {
  const deck = req.params[0];
  // Back-compat: the old master URL was /decks/<deck>/?speaker=1.
  // Speaker view is now its own page; redirect so old links keep working.
  if (req.query.speaker) {
    const qs = req.query.secret
      ? `?secret=${encodeURIComponent(String(req.query.secret))}`
      : '';
    return res.redirect(302, `/speaker/${encodeURIComponent(deck)}${qs}`);
  }
  const indexPath = join(DECKS_DIR, deck, 'index.html');
  try {
    let html = await readFile(indexPath, 'utf8');
    const inject = INJECT_TEMPLATE(deck);
    html = html.includes('</body>')
      ? html.replace('</body>', inject + '</body>')
      : html + inject;
    res.type('html').send(html);
  } catch {
    next();
  }
});

// Everything else under /decks — figures, css, generated slides.html, etc. — verbatim.
app.use('/decks', express.static(DECKS_DIR, { fallthrough: true }));

// Landing page + injected client lib.
app.use('/', express.static(join(__dirname, 'public'), { extensions: ['html'] }));

const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

// Last published state per deck so followers that connect mid-session catch up.
const lastState = new Map();

function authenticated(secret) {
  if (!SECRET_REQUIRED) return true;
  if (typeof secret !== 'string' || secret.length === 0) return false;
  const candidate = Buffer.from(
    createHash('sha256').update(secret).digest('hex'),
    'utf8'
  );
  if (candidate.length !== SECRET_HASH_BUF.length) return false;
  return timingSafeEqual(candidate, SECRET_HASH_BUF);
}

io.on('connection', (socket) => {
  socket.on('multiplex-follow', ({ id } = {}) => {
    if (typeof id !== 'string' || !id) return;
    socket.join(`room:${id}`);
    const cached = lastState.get(id);
    if (cached) socket.emit(`sync:${id}`, cached);
  });

  socket.on('multiplex-statechanged', (data) => {
    if (!data || typeof data !== 'object') return;
    if (typeof data.id !== 'string' || !data.id) return;
    if (!authenticated(data.secret)) return;
    const { secret: _drop, ...clean } = data;
    lastState.set(data.id, clean);
    io.to(`room:${data.id}`).emit(`sync:${data.id}`, clean);
  });
});

http.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`  reveal-deck-server ready`);
  console.log(`  → http://${shown}:${PORT}/`);
  console.log(`  → decks dir: ${DECKS_DIR}`);
  console.log(`  → master secret: ${SECRET_REQUIRED ? 'required (DECK_SECRET set)' : 'not required — anyone can drive'}`);
});
