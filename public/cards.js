// Shared rendering helpers for car cards (consumer chat, agent console, dealer page).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `$${Number(n).toLocaleString()}`;
const TYPE_ICON = { suv: '🚙', pickup: '🛻', minivan: '🚐', coupe: '🏎️', convertible: '🏎️', sedan: '🚗', hatchback: '🚗', wagon: '🚗', crossover: '🚙' };

// Model-family slugs for the imagin.studio render CDN, keyed by car id.
const IMAGIN_MODEL = {
  'toyota-corolla': 'corolla', 'toyota-camry-hybrid': 'camry', 'toyota-rav4-hybrid': 'rav4', 'toyota-highlander': 'highlander',
  'toyota-tacoma': 'tacoma', 'honda-civic': 'civic', 'honda-accord-hybrid': 'accord', 'honda-crv': 'cr-v', 'honda-odyssey': 'odyssey',
  'tesla-model-3': 'model-3', 'tesla-model-y': 'model-y', 'hyundai-ioniq5': 'ioniq-5', 'hyundai-elantra': 'elantra',
  'hyundai-tucson-hybrid': 'tucson', 'kia-ev6': 'ev6', 'kia-telluride': 'telluride', 'kia-sportage-phev': 'sportage',
  'ford-f150': 'f-150', 'ford-mustang': 'mustang', 'ford-mach-e': 'mustang-mach-e', 'ford-maverick': 'maverick',
  'chevrolet-equinox-ev': 'equinox-ev', 'chevrolet-trax': 'trax', 'bmw-3-series': '3-series', 'bmw-x5': 'x5', 'bmw-i4': 'i4',
  'mercedes-c300': 'c-class', 'mercedes-gle': 'gle-class', 'audi-q4-etron': 'q4-e-tron', 'mazda-cx5': 'cx-5', 'mazda-mx5': 'mx-5',
  'subaru-outback': 'outback', 'subaru-crosstrek': 'crosstrek', 'vw-id4': 'id.4', 'vw-golf-gti': 'golf', 'nissan-leaf': 'leaf',
  'chrysler-pacifica-hybrid': 'pacifica', 'jeep-wrangler': 'wrangler',
};

// car.image (explicit URL) wins; otherwise a studio render; otherwise the SVG fallback.
function carImageUrl(car) {
  if (car.image) return car.image;
  const family = IMAGIN_MODEL[car.id] || car.model.split(' ')[0];
  const make = car.make.toLowerCase().replace(/[^a-z]+/g, '-');
  const q = new URLSearchParams({ customer: 'img', make, modelFamily: family.toLowerCase(), modelYear: car.year, angle: '23', zoomType: 'fullscreen', width: '600' });
  return `https://cdn.imagin.studio/getImage?${q}`;
}

const FUEL_HUE = { electric: 150, hybrid: 190, 'plug-in hybrid': 170, petrol: 220, diesel: 30 };
const SILHOUETTE = {
  sedan: 'M14 62 L30 60 L52 44 Q60 40 72 40 L122 40 Q134 40 144 48 L162 60 L186 64 Q194 66 194 74 L194 82 L6 82 L6 72 Q6 64 14 62 Z',
  suv: 'M10 58 L20 36 Q24 30 34 30 L132 30 Q142 30 150 38 L166 56 L188 60 Q194 62 194 70 L194 82 L6 82 L6 66 Q6 60 10 58 Z',
  pickup: 'M8 56 L22 34 Q26 30 34 30 L92 30 L96 54 L190 54 Q194 54 194 60 L194 82 L6 82 L6 62 Q6 58 8 56 Z',
  minivan: 'M10 56 L34 30 Q38 26 48 26 L174 26 Q186 26 188 38 L192 64 Q194 70 194 74 L194 82 L6 82 L6 64 Q6 58 10 56 Z',
  coupe: 'M10 66 L40 60 L68 46 Q76 42 88 42 L118 42 Q132 42 146 52 L162 62 L188 66 Q194 68 194 74 L194 82 L6 82 L6 72 Q6 68 10 66 Z',
  hatchback: 'M12 62 L32 58 L56 40 Q62 36 72 36 L136 36 Q146 36 152 46 L162 60 L188 64 Q194 66 194 72 L194 82 L6 82 L6 70 Q6 64 12 62 Z',
};
SILHOUETTE.convertible = SILHOUETTE.coupe; SILHOUETTE.crossover = SILHOUETTE.suv; SILHOUETTE.wagon = SILHOUETTE.suv;

function carFallbackSvg(car) {
  const hue = FUEL_HUE[car.fuel] ?? 220;
  return `<svg viewBox="0 0 200 100" role="img" aria-label="${esc(car.type)}">
    <path d="${SILHOUETTE[car.type] || SILHOUETTE.sedan}" fill="hsl(${hue} 55% 45%)" />
    <circle cx="46" cy="82" r="12" fill="#2a2e35" /><circle cx="46" cy="82" r="5" fill="#9aa1ac" />
    <circle cx="154" cy="82" r="12" fill="#2a2e35" /><circle cx="154" cy="82" r="5" fill="#9aa1ac" />
  </svg>`;
}

// match = { car, score?, breakdown?, dealer? }; opts = { prefs, onVote, voted, showBreakdown }
function carCard(match, opts = {}) {
  const { car, score, breakdown, dealer } = match;
  const wanted = (opts.prefs?.features || []).map((f) => f.toLowerCase());
  const el = document.createElement('div');
  el.className = 'car';
  el.innerHTML = `
    <div class="car-photo" data-fuel="${esc(car.fuel)}">
      <img src="${esc(carImageUrl(car))}" alt="${esc(car.year)} ${esc(car.make)} ${esc(car.model)}" loading="lazy" decoding="async">
      <span class="fuel-badge">${esc(car.fuel)}</span>
    </div>
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
  const img = el.querySelector('.car-photo img');
  img.addEventListener('error', () => img.replaceWith(Object.assign(document.createElement('div'), { className: 'car-fallback', innerHTML: carFallbackSvg(car) })), { once: true });
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
