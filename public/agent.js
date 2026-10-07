// Agent / admin console: watch live chats, take over, correct what the AI
// understood, tune the matching model and manage dealers.

const $ = (id) => document.getElementById(id);
const TOKEN = new URLSearchParams(location.search).get('token') || '';
const LABELS = { user: 'Customer', bot: 'AI assistant', agent: 'You (advisor)' };

const state = { conversations: new Map(), activeId: null, active: null, model: null, dealers: [] };

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const csv = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const ago = (ts) => { const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };

// ------------------------------------------------------------------ tabs
$('tabs').addEventListener('click', (e) => {
  const view = e.target.dataset.view;
  if (!view) return;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b === e.target));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'dealers') loadDealers();
});

// --------------------------------------------------------- live updates
function connect() {
  const es = new EventSource(`/api/agent/stream?token=${encodeURIComponent(TOKEN)}`);
  es.addEventListener('init', (e) => {
    const { conversations, model, llm } = JSON.parse(e.data);
    state.conversations = new Map(conversations.map((c) => [c.id, c]));
    $('llm').textContent = llm.enabled ? `LLM: CodeMie · ${llm.model}` : 'LLM: offline demo mode';
    renderList();
    setModel(model);
  });
  es.addEventListener('conversation', (e) => {
    const c = JSON.parse(e.data);
    state.conversations.set(c.id, c);
    renderList();
    if (c.id === state.activeId) refreshActive();
  });
  es.addEventListener('message', (e) => {
    const { conversationId, message } = JSON.parse(e.data);
    if (conversationId === state.activeId && state.active) {
      state.active.messages.push(message);
      appendMessage(message);
    }
  });
  es.addEventListener('model', (e) => setModel(JSON.parse(e.data)));
  es.addEventListener('dealers', (e) => renderDealers(JSON.parse(e.data)));
}

// ------------------------------------------------------- conversations
function renderList() {
  const list = [...state.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  $('conv-count').textContent = list.length;
  if (!list.length) return;
  $('conv-list').innerHTML = list.map((c) => `
    <div class="conv-item ${c.id === state.activeId ? 'active' : ''}" data-id="${esc(c.id)}">
      <div class="row" style="justify-content:space-between">
        <b>${esc(c.name)}</b><span class="small muted">${ago(c.updatedAt)}</span>
      </div>
      <div class="row small" style="margin:3px 0">
        <span class="pill">${esc(c.channel)}</span>
        <span class="pill ${c.mode === 'human' ? 'warn' : 'ok'}">${c.mode === 'human' ? '👤 advisor' : '🤖 AI'}</span>
        ${c.handoffRequested ? '<span class="pill bad">🔔 wants a human</span>' : ''}
        ${c.ready ? '<span class="pill">matched</span>' : ''}
      </div>
      <div class="last">${c.lastMessage ? `${esc(LABELS[c.lastMessage.role] || '')}: ${esc(c.lastMessage.text)}` : ''}</div>
    </div>`).join('');
}

$('conv-list').addEventListener('click', (e) => {
  const item = e.target.closest('.conv-item');
  if (item) openConversation(item.dataset.id);
});

async function openConversation(id) {
  state.activeId = id;
  state.active = await api(`/api/agent/conversation?id=${encodeURIComponent(id)}`);
  renderList();
  renderChat();
  renderSide(true);
}

let refreshTimer;
function refreshActive() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    const fresh = await api(`/api/agent/conversation?id=${encodeURIComponent(state.activeId)}`);
    const modeChanged = fresh.mode !== state.active.mode || fresh.handoffRequested !== state.active.handoffRequested;
    state.active = fresh;
    if (modeChanged) renderChat(); else renderTyping();
    renderSide(false);
  }, 150);
}

function renderChat() {
  const c = state.active;
  const human = c.mode === 'human';
  $('chat-col').innerHTML = `
    <div class="panel-head" style="background:var(--surface)">
      <div><b>${esc(c.name)}</b> <span class="pill">${esc(c.channel)}</span></div>
      <div class="row">
        <button id="send-matches" title="Send the current top matches to the customer">🚗 Send top matches</button>
        <button id="takeover" class="${human ? '' : 'primary'}">${human ? '🤖 Hand back to AI' : '👤 Take over chat'}</button>
      </div>
    </div>
    ${c.handoffRequested ? '<div class="alert">🔔 The customer asked to talk to a person. Take over to reply.</div>' : ''}
    <div class="messages" id="agent-messages"></div>
    <form class="composer" id="agent-composer">
      <input id="agent-input" placeholder="${human ? 'Reply as sales advisor…' : 'Take over the chat to reply'}" ${human ? '' : 'disabled'} autocomplete="off">
      <button class="primary" ${human ? '' : 'disabled'}>Send</button>
    </form>`;
  for (const m of c.messages) appendMessage(m);
  renderTyping();
  $('takeover').onclick = () => api('/api/agent/mode', { id: c.id, mode: human ? 'bot' : 'human' });
  $('send-matches').onclick = () => api('/api/agent/send-matches', { id: c.id });
  $('agent-composer').onsubmit = (e) => {
    e.preventDefault();
    const text = $('agent-input').value;
    if (!text.trim()) return;
    $('agent-input').value = '';
    api('/api/agent/message', { id: c.id, text });
  };
  if (human) $('agent-input').focus();
}

function appendMessage(m) {
  const box = $('agent-messages');
  if (!box) return;
  box.querySelector('.typing')?.remove();
  box.appendChild(messageEl(m, { labels: LABELS, prefs: state.active.prefs }));
  renderTyping();
  box.scrollTop = box.scrollHeight;
}

function renderTyping() {
  const box = $('agent-messages');
  if (!box) return;
  box.querySelector('.typing')?.remove();
  if (state.active.typing) box.insertAdjacentHTML('beforeend', '<div class="typing">AI is typing…</div>');
  box.scrollTop = box.scrollHeight;
}

// Right panel: what the AI understood (editable) + live matches with score breakdown
function renderSide(force) {
  const c = state.active;
  const p = c.prefs || {};
  const form = $('prefs-form');
  // Don't clobber the form while the agent is typing in it
  if (!force && form && form.contains(document.activeElement)) return renderMatches();
  $('side').innerHTML = `
    <div class="panel-head"><h3>What the AI understood</h3>${c.ready ? '<span class="pill ok">ready</span>' : '<span class="pill">gathering</span>'}</div>
    <div class="scroll">
      <form class="section" id="prefs-form">
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="field"><label>Budget (max $)</label><input name="budgetMax" type="number" value="${p.budgetMax || ''}"></div>
          <div class="field"><label>Min seats</label><input name="seatsMin" type="number" value="${p.seatsMin || ''}"></div>
        </div>
        <div class="field"><label>Body types</label><input name="types" value="${esc((p.types || []).join(', '))}"></div>
        <div class="field"><label>Fuel</label><input name="fuels" value="${esc((p.fuels || []).join(', '))}"></div>
        <div class="field"><label>Brands</label><input name="brands" value="${esc((p.brands || []).join(', '))}"></div>
        <div class="field"><label>Features</label><input name="features" value="${esc((p.features || []).join(', '))}"></div>
        ${p.notes ? `<div class="small"><span class="muted">Notes:</span> ${esc(p.notes)}</div>` : ''}
        <button class="primary">Correct &amp; re-rank</button>
      </form>
      <div class="section"><h3>Current top matches</h3><div id="side-matches"></div></div>
    </div>`;
  $('prefs-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.active = await api('/api/agent/prefs', {
      id: c.id,
      prefs: {
        budgetMax: Number(f.get('budgetMax')) || null, seatsMin: Number(f.get('seatsMin')) || null,
        types: csv(f.get('types')), fuels: csv(f.get('fuels')), brands: csv(f.get('brands')), features: csv(f.get('features')),
      },
    });
    renderSide(true);
  };
  renderMatches();
}

function renderMatches() {
  const box = $('side-matches');
  if (!box) return;
  const c = state.active;
  box.innerHTML = c.matches?.length ? '' : '<div class="small muted">No recommendations yet.</div>';
  for (const m of c.matches || []) {
    box.appendChild(carCard(m, {
      prefs: c.prefs, showBreakdown: true,
      onVote: (carId, liked) => api('/api/agent/feedback', { id: c.id, carId, liked }),
    }));
  }
}

// ------------------------------------------------------- matching model
function setModel(model) {
  state.model = model;
  const w = $('weights');
  if (!w.contains(document.activeElement)) {
    w.innerHTML = Object.entries(model.weights).map(([k, v]) => `
      <div class="slider"><span>${k}</span><input type="range" min="0" max="5" step="0.1" value="${v}" data-k="${k}"><b>${v}</b></div>`).join('');
  }
  $('tolerance').value = model.budgetTolerance;
  $('tolerance-v').textContent = `${Math.round(model.budgetTolerance * 100)}%`;
  $('autolearn').checked = model.autoLearn;

  const boosts = Object.entries(model.boosts).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  $('boosts').innerHTML = boosts.length ? `<table>${boosts.map(([id, v]) => `
    <tr><td>${esc(id)}</td><td style="width:50%"><div class="bar"><i style="width:${Math.round((v + 1) * 50)}%;background:${v >= 0 ? 'var(--ok)' : 'var(--bad)'}"></i></div></td><td>${v > 0 ? '+' : ''}${v.toFixed(1)}</td></tr>`).join('')}</table>`
    : '<span class="muted">No feedback yet. 👍 / 👎 on recommended cars builds these up.</span>';
  $('feedback').innerHTML = model.feedback.length ? `<table>${model.feedback.slice(0, 15).map((f) => `
    <tr><td>${f.liked ? '👍' : '👎'}</td><td>${esc(f.car)}</td><td class="muted">${esc(f.source)}</td><td class="muted">${ago(f.at)}</td></tr>`).join('')}</table>`
    : '<span class="muted">Nothing yet.</span>';
  playground();
}

let tuneTimer;
$('weights').addEventListener('input', (e) => {
  if (!e.target.dataset.k) return;
  e.target.nextElementSibling.textContent = e.target.value;
  clearTimeout(tuneTimer);
  tuneTimer = setTimeout(() => api('/api/agent/model', { weights: { [e.target.dataset.k]: Number(e.target.value) } }), 150);
});
$('tolerance').addEventListener('change', (e) => api('/api/agent/model', { budgetTolerance: Number(e.target.value) }));
$('autolearn').addEventListener('change', (e) => api('/api/agent/model', { autoLearn: e.target.checked }));
$('reset-model').onclick = () => confirm('Reset weights and all learned feedback?') && api('/api/agent/model/reset', {});

async function playground() {
  const get = (n) => $('play-form').querySelector(`[name=${n}]`).value;
  const prefs = {
    budgetMax: Number(get('budgetMax')) || null, seatsMin: Number(get('seatsMin')) || null,
    types: csv(get('types')), fuels: csv(get('fuels')), brands: csv(get('brands')), features: csv(get('features')),
  };
  const results = await api('/api/agent/preview', { prefs });
  const box = $('play-results');
  box.innerHTML = results.length ? '' : '<div class="small muted">No cars match.</div>';
  for (const m of results) box.appendChild(carCard(m, { prefs, showBreakdown: true }));
}
$('play-form').addEventListener('input', () => { clearTimeout(tuneTimer); tuneTimer = setTimeout(playground, 250); });

// --------------------------------------------------------------- dealers
async function loadDealers() {
  renderDealers(await api('/api/agent/dealers'));
}

function renderDealers(list) {
  state.dealers = list;
  $('dealer-rows').innerHTML = list.map((d) => `
    <tr>
      <td><b>${esc(d.name)}</b><div class="small muted">${esc(d.city)}</div></td>
      <td class="small">${esc(d.phone)}<br>${esc(d.email)}</td>
      <td>${d.stock} cars</td>
      <td><span class="pill ${d.status === 'active' ? 'ok' : 'bad'}">${esc(d.status)}</span></td>
      <td><div class="row" style="justify-content:flex-end;flex-wrap:wrap">
        <a href="/dealer.html?id=${encodeURIComponent(d.id)}" target="_blank" class="small">Page ↗</a>
        <button class="small" data-act="edit" data-id="${esc(d.id)}">Edit</button>
        <button class="small" data-act="toggle" data-id="${esc(d.id)}">${d.status === 'active' ? 'Block' : 'Unblock'}</button>
        <button class="small danger" data-act="delete" data-id="${esc(d.id)}">Delete</button>
      </div></td>
    </tr>`).join('');
}

$('dealer-rows').addEventListener('click', async (e) => {
  const { act, id } = e.target.dataset;
  const d = state.dealers.find((x) => x.id === id);
  if (!act || !d) return;
  if (act === 'toggle') api('/api/agent/dealers/update', { id, status: d.status === 'active' ? 'blocked' : 'active' });
  if (act === 'delete' && confirm(`Delete ${d.name}? Their ${d.stock} cars will no longer be recommended.`)) api('/api/agent/dealers/delete', { id });
  if (act === 'edit') {
    const form = $('dealer-form');
    for (const k of ['id', 'name', 'city', 'phone', 'email', 'description']) form.elements[k].value = d[k] || '';
    $('dealer-form-title').textContent = `Edit ${d.name}`;
    $('dealer-submit').textContent = 'Save changes';
    $('dealer-cancel').hidden = false;
    form.scrollIntoView({ behavior: 'smooth' });
  }
});

function resetDealerForm() {
  $('dealer-form').reset();
  $('dealer-form').elements.id.value = '';
  $('dealer-form-title').textContent = 'Add dealer';
  $('dealer-submit').textContent = 'Add dealer';
  $('dealer-cancel').hidden = true;
}
$('dealer-cancel').onclick = resetDealerForm;
$('dealer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    await api(data.id ? '/api/agent/dealers/update' : '/api/agent/dealers', data);
    resetDealerForm();
  } catch (err) {
    alert(err.message);
  }
});

connect();
