// In-memory conversation store + event bus. Every change emits an event that
// the agent console (and the web channel) listen to over Server-Sent Events.
// Swap for Redis/Postgres later without touching channels or the assistant.

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const bus = new EventEmitter();
bus.setMaxListeners(100);
const conversations = new Map();

function getOrCreate({ channel, externalId, name }) {
  const id = `${channel}:${externalId}`;
  if (!conversations.has(id)) {
    conversations.set(id, {
      id,
      channel,
      externalId,
      name: name || `Guest ${conversations.size + 1}`,
      mode: 'bot', // 'bot' = AI replies, 'human' = an agent has taken over
      prefs: {},
      ready: false,
      matches: [],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    emit('conversation', conversations.get(id));
  }
  return conversations.get(id);
}

function addMessage(conv, msg) {
  const message = { id: crypto.randomUUID(), ts: Date.now(), ...msg };
  conv.messages.push(message);
  conv.updatedAt = message.ts;
  bus.emit('message', { conversationId: conv.id, message });
  emit('conversation', conv);
  return message;
}

function update(conv, patch) {
  Object.assign(conv, patch, { updatedAt: Date.now() });
  emit('conversation', conv);
  return conv;
}

function emit(type, conv) {
  bus.emit(type, summary(conv));
}

// What list views need (no full transcript).
function summary(conv) {
  const last = conv.messages.at(-1);
  return {
    id: conv.id, channel: conv.channel, name: conv.name, mode: conv.mode,
    prefs: conv.prefs, ready: conv.ready, updatedAt: conv.updatedAt,
    lastMessage: last ? { role: last.role, text: last.text } : null,
    messageCount: conv.messages.length,
  };
}

const get = (id) => conversations.get(id);
const list = () => [...conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(summary);

module.exports = { bus, getOrCreate, addMessage, update, get, list, summary };
