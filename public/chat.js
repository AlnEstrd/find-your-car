// Consumer chat. The web channel is just one adapter: same backend serves Telegram etc.

const $ = (id) => document.getElementById(id);
const messagesEl = $('messages'), chipsEl = $('chips'), input = $('input');

let visitorId = localStorage.getItem('fyc-visitor');
if (!visitorId) localStorage.setItem('fyc-visitor', (visitorId = crypto.randomUUID()));

const WELCOME = {
  role: 'bot',
  text: "Hi! 👋 I'm your personal car finder. Tell me what you're looking for, or tap an option below to get started.",
  suggestions: ['A family SUV', 'Something electric', 'A cheap first car', 'A pickup for work'],
};
const LABELS = { agent: 'Sales advisor' };
let lastMessage = null, typingEl = null, events = null;

function render(m) {
  messagesEl.appendChild(messageEl(m, { labels: LABELS, onVote: m.cars ? vote : null }));
  messagesEl.scrollTop = messagesEl.scrollHeight;
  if (m.role !== 'system') lastMessage = m;
  renderChips();
}

function renderChips() {
  chipsEl.innerHTML = '';
  for (const s of lastMessage?.role !== 'user' ? lastMessage?.suggestions || [] : []) {
    const b = document.createElement('button');
    b.textContent = s;
    b.onclick = () => send(s);
    chipsEl.appendChild(b);
  }
}

function setTyping(on) {
  if (on && !typingEl) {
    typingEl = Object.assign(document.createElement('div'), { className: 'typing', textContent: 'typing…' });
    messagesEl.appendChild(typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } else if (!on && typingEl) {
    typingEl.remove();
    typingEl = null;
  }
}

async function send(text) {
  if (!text.trim()) return;
  input.value = '';
  await fetch('/api/web/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId, text }),
  });
}

function vote(carId, liked) {
  fetch('/api/web/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId, carId, liked }),
  });
}

function connect() {
  messagesEl.innerHTML = '';
  render(WELCOME);
  events?.close();
  events = new EventSource(`/api/web/stream?visitorId=${encodeURIComponent(visitorId)}`);
  let seen = new Set();
  events.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (seen.has(m.id)) return; // replayed after a reconnect
    seen.add(m.id);
    setTyping(false);
    render(m);
  });
  events.addEventListener('status', (e) => {
    const s = JSON.parse(e.data);
    setTyping(s.typing);
    $('status').textContent = s.mode === 'human' ? 'Sales advisor · online' : 'AI assistant · online';
  });
}

$('composer').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
$('restart').onclick = () => {
  localStorage.setItem('fyc-visitor', (visitorId = crypto.randomUUID()));
  connect();
};
connect();
