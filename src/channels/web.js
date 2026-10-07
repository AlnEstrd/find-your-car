// Web chat channel: the built-in consumer UI at "/".
// Inbound: POST /api/web/messages. Outbound: Server-Sent Events stream per visitor.

const store = require('../core/conversations');
const assistant = require('../core/assistant');
const matcher = require('../core/matcher');
const { readJson, sse } = require('../http');

module.exports = {
  name: 'web',

  routes: {
    // Visitor sends a message
    'POST /api/web/messages': async (req, res) => {
      const { visitorId, text, name } = await readJson(req);
      if (!visitorId || !text?.trim()) return res.json({ error: 'visitorId and text required' }, 400);
      assistant.handleIncoming({ channel: 'web', externalId: visitorId, name, text: text.trim() });
      res.json({ ok: true });
    },

    // Visitor's live stream: past messages first, then new ones as they happen
    'GET /api/web/stream': (req, res, url) => {
      const conversationId = `web:${url.searchParams.get('visitorId')}`;
      const send = sse(res);
      const conv = store.get(conversationId);
      for (const message of conv?.messages || []) send('message', message);
      if (conv) send('status', status(conv));

      const onMessage = (e) => e.conversationId === conversationId && send('message', e.message);
      const onConv = (c) => c.id === conversationId && send('status', status(store.get(c.id)));
      store.bus.on('message', onMessage);
      store.bus.on('conversation', onConv);
      req.on('close', () => {
        store.bus.off('message', onMessage);
        store.bus.off('conversation', onConv);
      });
    },

    // 👍 / 👎 on a recommended car
    'POST /api/web/feedback': async (req, res) => {
      const { visitorId, carId, liked } = await readJson(req);
      const conv = store.get(`web:${visitorId}`);
      matcher.feedback({ carId, liked, prefs: conv?.prefs, source: 'consumer', conversationId: conv?.id });
      store.bus.emit('model', matcher.getModel());
      res.json({ ok: true });
    },
  },
};

const status = (conv) => ({ mode: conv.mode, typing: !!conv.typing });
