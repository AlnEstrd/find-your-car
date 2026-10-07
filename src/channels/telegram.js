// Telegram channel: proves the chat interface is swappable.
// Set TELEGRAM_BOT_TOKEN (from @BotFather) and it starts long-polling; no
// public URL/webhook needed for a demo. Same assistant, same agent console.

const store = require('../core/conversations');
const assistant = require('../core/assistant');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

// Telegram has no "cards", so recommendations are rendered as text.
function format(message) {
  const prefix = message.role === 'agent' ? '👤 ' : '';
  const cars = (message.cars || []).map(({ car, score, dealer }) =>
    `\n\n🚗 ${car.year} ${car.make} ${car.model}: $${car.price.toLocaleString()} (${score}% match)\n` +
    `${car.type} · ${car.fuel} · ${car.seats} seats · ${car.horsepower} hp · ${car.efficiency}\n` +
    `✓ ${car.features.join(', ')}` + (dealer ? `\n🏪 ${dealer.name}, ${dealer.city}` : '')).join('');
  return prefix + message.text + cars;
}

module.exports = {
  name: 'telegram',
  routes: {},

  start() {
    if (!TOKEN) return console.log('[telegram] disabled (set TELEGRAM_BOT_TOKEN to enable)');

    // Outbound: anything the bot or an agent says in a telegram conversation
    store.bus.on('message', ({ conversationId, message }) => {
      const conv = store.get(conversationId);
      if (conv?.channel !== 'telegram' || message.role === 'user') return;
      const suggestions = message.suggestions?.length
        ? { reply_markup: { keyboard: [message.suggestions.map((text) => ({ text }))], resize_keyboard: true, one_time_keyboard: true } }
        : {};
      api('sendMessage', { chat_id: conv.externalId, text: format(message), ...suggestions }).catch(console.error);
    });

    // Inbound: long-poll for updates
    let offset = 0;
    const poll = async () => {
      try {
        const { result = [] } = await api('getUpdates', { offset, timeout: 30 });
        for (const u of result) {
          offset = u.update_id + 1;
          const msg = u.message;
          if (!msg?.text) continue;
          const text = msg.text === '/start' ? 'Hi! I am looking for a car.' : msg.text;
          assistant.handleIncoming({
            channel: 'telegram', externalId: String(msg.chat.id),
            name: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' '), text,
          });
        }
      } catch (err) {
        console.error('[telegram]', err.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
      poll();
    };
    poll();
    console.log('[telegram] polling for messages');
  },
};
