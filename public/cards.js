// Shared rendering helpers for car cards (consumer chat, agent console, dealer page).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `$${Number(n).toLocaleString()}`;
const TYPE_ICON = { suv: '🚙', pickup: '🛻', minivan: '🚐', coupe: '🏎️', convertible: '🏎️', sedan: '🚗', hatchback: '🚗', wagon: '🚗', crossover: '🚙' };

// match = { car, score?, breakdown?, dealer? }; opts = { prefs, onVote, voted, showBreakdown }
function carCard(match, opts = {}) {
  const { car, score, breakdown, dealer } = match;
  const wanted = (opts.prefs?.features || []).map((f) => f.toLowerCase());
  const el = document.createElement('div');
  el.className = 'car';
  el.innerHTML = `
    <div class="car-head">
      <h4>${TYPE_ICON[car.type] || '🚗'} ${esc(car.year)} ${esc(car.make)} ${esc(car.model)}</h4>
      ${score != null ? `<span class="score">${score}% match</span>` : ''}
    </div>
    <div class="price">${money(car.price)}</div>
    <div class="specs">
      <div><span>Type</span> ${esc(car.type)}</div><div><span>Fuel</span> ${esc(car.fuel)}</div>
      <div><span>Seats</span> ${esc(car.seats)}</div><div><span>Power</span> ${esc(car.horsepower)} hp</div>
      <div><span>Economy</span> ${esc(car.efficiency)}</div><div><span>Drive</span> ${esc(car.drivetrain)} · ${esc(car.transmission)}</div>
    </div>
    <div class="tags">${car.features.map((f) => `<span class="${wanted.includes(f) ? 'hit' : ''}">${esc(f)}</span>`).join('')}</div>
    ${opts.showBreakdown && breakdown ? `<div class="breakdown">${Object.entries(breakdown).map(([k, v]) =>
      `<span class="muted">${k}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div><span>${Math.round(v * 100)}</span>`).join('')}</div>` : ''}
    <div class="car-foot">
      ${dealer ? `<a href="/dealer.html?id=${encodeURIComponent(dealer.id)}" target="_blank">${esc(dealer.name)}</a>` : '<span></span>'}
      ${opts.onVote ? `<div class="vote"><button data-v="1" title="Good match">👍</button><button data-v="0" title="Not for me">👎</button></div>` : ''}
    </div>`;
  if (opts.onVote) {
    el.querySelectorAll('.vote button').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('.vote button').forEach((x) => x.classList.toggle('on', x === b));
      opts.onVote(car.id, b.dataset.v === '1');
    }));
  }
  return el;
}

// Renders one chat message (used by both consumer and agent views).
function messageEl(m, opts = {}) {
  const el = document.createElement('div');
  el.className = `msg ${m.role}${m.cars?.length ? ' with-cars' : ''}`;
  const who = opts.labels?.[m.role];
  el.innerHTML = `${who ? `<span class="who">${esc(who)}</span>` : ''}${esc(m.text)}`;
  if (m.cars?.length) {
    const grid = document.createElement('div');
    grid.className = 'cars';
    for (const match of m.cars) grid.appendChild(carCard(match, opts));
    el.appendChild(grid);
  }
  return el;
}
