// Find Your Car: AI car-recommender chat. Run with `npm start` (or `node server.js`).
try { process.loadEnvFile(); } catch { /* .env is optional */ }

const http = require('node:http');
const { readJson, sse, json, serveStatic } = require('./src/http');
const store = require('./src/core/conversations');
const assistant = require('./src/core/assistant');
const matcher = require('./src/core/matcher');
const dealers = require('./src/core/dealers');
const llm = require('./src/core/llm');
const channels = require('./src/channels');

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// ------------------------------------------------- agent / admin console API
const agentRoutes = {
  'GET /api/agent/stream': (req, res) => {
    const send = sse(res);
    send('init', { conversations: store.list(), model: matcher.getModel(), llm: { enabled: llm.enabled(), model: llm.model } });
    const handlers = {
      conversation: (c) => send('conversation', c),
      message: (e) => send('message', e),
      model: (m) => send('model', m),
      dealers: (d) => send('dealers', d),
    };
    for (const [ev, fn] of Object.entries(handlers)) store.bus.on(ev, fn);
    req.on('close', () => { for (const [ev, fn] of Object.entries(handlers)) store.bus.off(ev, fn); });
  },

  'GET /api/agent/conversation': (req, res, url) => {
    const conv = store.get(url.searchParams.get('id'));
    conv ? res.json(conv) : res.json({ error: 'not found' }, 404);
  },

  // Take over / hand back to the bot
  'POST /api/agent/mode': async (req, res) => {
    const { id, mode } = await readJson(req);
    const conv = store.get(id);
    if (!conv || !['bot', 'human'].includes(mode)) return res.json({ error: 'bad request' }, 400);
    store.update(conv, { mode, handoffRequested: false });
    store.addMessage(conv, {
      role: 'system',
      text: mode === 'human' ? 'A sales advisor has joined the chat.' : "You're chatting with our AI assistant again.",
    });
    res.json({ ok: true });
  },

  'POST /api/agent/message': async (req, res) => {
    const { id, text } = await readJson(req);
    const conv = store.get(id);
    if (!conv || !text?.trim()) return res.json({ error: 'bad request' }, 400);
    store.addMessage(conv, { role: 'agent', text: text.trim() });
    res.json({ ok: true });
  },

  // Agent corrects what the AI understood (and optionally re-ranks)
  'POST /api/agent/prefs': async (req, res) => {
    const { id, prefs } = await readJson(req);
    const conv = store.get(id);
    if (!conv) return res.json({ error: 'not found' }, 404);
    store.update(conv, { prefs: { ...conv.prefs, ...prefs }, matches: matcher.rank({ ...conv.prefs, ...prefs }, 3) });
    res.json(conv);
  },

  'POST /api/agent/send-matches': async (req, res) => {
    const conv = store.get((await readJson(req)).id);
    if (!conv) return res.json({ error: 'not found' }, 404);
    assistant.sendMatches(conv);
    res.json({ ok: true });
  },

  'POST /api/agent/preview': async (req, res) => {
    const { prefs } = await readJson(req);
    res.json(matcher.rank(prefs || {}, 5));
  },

  // Matching model tuning
  'POST /api/agent/model': async (req, res) => modelChanged(res, matcher.updateModel(await readJson(req))),
  'POST /api/agent/model/reset': (req, res) => modelChanged(res, matcher.resetModel()),
  'POST /api/agent/feedback': async (req, res) => {
    const { id, carId, liked } = await readJson(req);
    const conv = store.get(id);
    modelChanged(res, matcher.feedback({ carId, liked, prefs: conv?.prefs, source: 'agent', conversationId: id }));
  },

  // Dealer management
  'GET /api/agent/dealers': (req, res) => res.json(dealersWithStock()),
  'POST /api/agent/dealers': async (req, res) => {
    try { dealers.add(await readJson(req)); dealersChanged(res); } catch (e) { res.json({ error: e.message }, 400); }
  },
  'POST /api/agent/dealers/update': async (req, res) => {
    const { id, ...patch } = await readJson(req);
    dealers.update(id, patch) ? dealersChanged(res) : res.json({ error: 'not found' }, 404);
  },
  'POST /api/agent/dealers/delete': async (req, res) => {
    dealers.remove((await readJson(req)).id) ? dealersChanged(res) : res.json({ error: 'not found' }, 404);
  },
};

function modelChanged(res, model) {
  store.bus.emit('model', model);
  res.json(model);
}

function dealersWithStock() {
  return dealers.list().map((d) => ({ ...d, stock: matcher.cars.filter((c) => c.dealerId === d.id).length }));
}

function dealersChanged(res) {
  const list = dealersWithStock();
  store.bus.emit('dealers', list);
  res.json(list);
}

// ------------------------------------------------------------ public API
const publicRoutes = {
  'GET /api/dealer': (req, res, url) => {
    const dealer = dealers.get(url.searchParams.get('id'));
    if (!dealer) return res.json({ error: 'not found' }, 404);
    if (dealer.status !== 'active') return res.json({ dealer: { name: dealer.name, status: dealer.status }, cars: [] });
    res.json({ dealer, cars: matcher.cars.filter((c) => c.dealerId === dealer.id) });
  },
  'GET /api/health': (req, res) => res.json({ ok: true, llm: llm.enabled() }),
};

// ---------------------------------------------------------------- server
const routes = { ...publicRoutes, ...agentRoutes, ...Object.assign({}, ...channels.map((c) => c.routes)) };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.json = json(res);
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) return serveStatic(res, url.pathname);

  // Optional shared-secret protection for the agent console API
  if (ADMIN_TOKEN && url.pathname.startsWith('/api/agent/')) {
    const token = req.headers['x-admin-token'] || url.searchParams.get('token');
    if (token !== ADMIN_TOKEN) return res.json({ error: 'unauthorized' }, 401);
  }
  try {
    await handler(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.json({ error: 'internal error' }, 500);
  }
}).listen(PORT, () => {
  for (const ch of channels) ch.start?.();
  console.log(`\n  Find Your Car running`);
  console.log(`  Consumer chat:  http://localhost:${PORT}/`);
  console.log(`  Agent console:  http://localhost:${PORT}/agent.html`);
  console.log(`  LLM:            ${llm.enabled() ? `CodeMie (${llm.model})` : 'offline mode (set CODEMIE_API_URL + CODEMIE_API_KEY)'}\n`);
});
