// The car-recommender brain. Channel-agnostic: it reads/writes conversations
// and never knows whether the user is on the web, Telegram or WhatsApp.
//
// Each user turn:
//   1. LLM extracts/updates structured preferences + writes the next question.
//   2. Once enough is known (or the user asks), the matcher ranks inventory and
//      the LLM writes a short, personal pitch for the top cars.
// If no LLM is configured (or it errors), a small rule-based parser takes over.

const store = require('./conversations');
const matcher = require('./matcher');
const llm = require('./llm');

const HANDOFF_RE = /\b(human|real person|agent|sales ?(person|rep|man|woman)|someone real|call me)\b/i;

async function handleIncoming({ channel, externalId, name, text }) {
  const conv = store.getOrCreate({ channel, externalId, name });
  store.addMessage(conv, { role: 'user', text });

  if (HANDOFF_RE.test(text) && conv.mode === 'bot') {
    store.update(conv, { handoffRequested: true });
    store.addMessage(conv, { role: 'bot', text: "Sure, I've let our sales team know. Someone will join this chat shortly. Meanwhile, feel free to keep telling me what you're after." });
    return conv;
  }
  if (conv.mode === 'human') return conv; // an agent is driving; stay quiet
  await respond(conv);
  return conv;
}

async function respond(conv) {
  store.update(conv, { typing: true });
  try {
    const turn = (await llmTurn(conv).catch((err) => {
      console.warn('[assistant] LLM failed, using offline parser:', err.message);
      return null;
    })) || offlineTurn(conv);

    store.update(conv, { prefs: turn.prefs, ready: turn.ready, typing: false });

    if (turn.ready) {
      const matches = matcher.rank(conv.prefs, 3);
      const text = (await llmPitch(conv, matches).catch(() => null)) || offlinePitch(matches);
      store.update(conv, { matches });
      store.addMessage(conv, {
        role: 'bot', text, cars: matches,
        suggestions: ['Show cheaper options', 'Only electric', 'Talk to a human'],
      });
    } else {
      store.addMessage(conv, { role: 'bot', text: turn.reply, suggestions: turn.suggestions });
    }
  } catch (err) {
    console.error('[assistant]', err);
    store.update(conv, { typing: false });
    store.addMessage(conv, { role: 'bot', text: 'Sorry, something went wrong on my side. Could you say that again?' });
  }
}

// Push the current best matches into the chat (used by agents in takeover mode).
function sendMatches(conv, role = 'agent') {
  const matches = matcher.rank(conv.prefs, 3);
  store.update(conv, { matches });
  return store.addMessage(conv, { role, text: 'Here are the cars I think fit you best:', cars: matches });
}

// ---------------------------------------------------------------- LLM path

const SYSTEM_PROMPT = `You are "Find Your Car", a friendly, concise sales assistant for a car retailer.
Your job: understand what the customer needs, then recommend cars from our inventory.

Ask ONE short question at a time, in this rough order, skipping anything already known:
budget -> body type -> fuel type -> must-have features / favourite brands / number of seats.
Infer what you can (e.g. "3 kids and a dog" => seatsMin 5+, maybe "third row"; "long commute" => hybrid/electric is a good hint, not a hard rule).
Set "ready": true when you know the budget plus at least two other things, OR the customer asks to see cars.

Map the customer's words ONLY onto this vocabulary (lowercase):
types: {{types}}
fuels: {{fuels}}
brands: {{brands}}
features: {{features}}

Reply with ONLY a JSON object, no prose around it:
{
  "reply": "your next message to the customer (1-2 sentences, warm, no lists)",
  "preferences": {
    "budgetMax": number|null, "types": string[], "fuels": string[], "brands": string[],
    "features": string[], "seatsMin": number|null, "notes": "short free-text summary of anything else"
  },
  "ready": boolean,
  "suggestions": ["2-4 short quick-reply options for the customer"]
}
"preferences" must be the FULL updated set (carry over what is already known; drop things the customer retracts).`;

function systemPrompt() {
  const v = matcher.vocabulary;
  return SYSTEM_PROMPT
    .replace('{{types}}', v.types.join(', '))
    .replace('{{fuels}}', v.fuels.join(', '))
    .replace('{{brands}}', v.brands.join(', ').toLowerCase())
    .replace('{{features}}', v.features.join(', '));
}

function history(conv) {
  return conv.messages.slice(-20).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.role === 'agent' ? `(human sales agent) ${m.text}` : m.text,
  }));
}

async function llmTurn(conv) {
  const raw = await llm.chat([
    { role: 'system', content: systemPrompt() },
    { role: 'system', content: `Known preferences so far: ${JSON.stringify(conv.prefs)}` },
    ...history(conv),
  ]);
  if (raw === null) return null; // LLM not configured
  const out = llm.parseJson(raw);
  return {
    reply: out.reply || 'Tell me a bit more about what you need?',
    prefs: cleanPrefs(out.preferences || {}),
    ready: !!out.ready,
    suggestions: (out.suggestions || []).slice(0, 4),
  };
}

async function llmPitch(conv, matches) {
  if (!matches.length) return null;
  const list = matches.map(({ car, score }) =>
    `- ${car.year} ${car.make} ${car.model} | $${car.price.toLocaleString()} | ${car.type}, ${car.fuel}, ${car.seats} seats, ${car.horsepower} hp, ${car.efficiency} | ${car.features.join(', ')} | match ${score}%`).join('\n');
  return llm.chat([
    { role: 'system', content: 'You are a friendly car sales assistant. In 2-4 sentences total, tell the customer why these cars fit what they asked for. Mention each car by name with its single best reason. The full spec cards are shown below your message, so do not repeat every spec. Plain text, no markdown.' },
    { role: 'user', content: `Customer preferences: ${JSON.stringify(conv.prefs)}\nTop matches:\n${list}` },
  ]);
}

function cleanPrefs(p) {
  const arr = (x) => (Array.isArray(x) ? x.map((s) => String(s).toLowerCase()) : []);
  return {
    budgetMax: Number(p.budgetMax) || null,
    types: arr(p.types), fuels: arr(p.fuels), brands: arr(p.brands), features: arr(p.features),
    seatsMin: Number(p.seatsMin) || null,
    notes: p.notes || '',
  };
}

// ------------------------------------------------------------ offline path
// Good enough to demo the full flow with no API key. Keyword based on purpose.

const SYN = {
  types: { truck: 'pickup', pickup: 'pickup', van: 'minivan', minivan: 'minivan', suv: 'suv', sedan: 'sedan', saloon: 'sedan', hatch: 'hatchback', coupe: 'coupe', 'sports car': 'coupe', convertible: 'convertible', cabrio: 'convertible', wagon: 'wagon', estate: 'wagon', crossover: 'crossover' },
  fuels: { electric: 'electric', ev: 'electric', 'plug-in': 'plug-in hybrid', phev: 'plug-in hybrid', hybrid: 'hybrid', petrol: 'petrol', gas: 'petrol', gasoline: 'petrol' },
  brands: { vw: 'volkswagen', mercedes: 'mercedes-benz', benz: 'mercedes-benz', chevy: 'chevrolet' },
  features: { carplay: 'apple carplay', 'android auto': 'android auto', 'all wheel': 'awd', 'all-wheel': 'awd', '4x4': '4wd', 'four wheel': '4wd', 'third row': 'third row', '3rd row': 'third row', sunroof: 'sunroof', 'panoramic': 'panoramic roof', leather: 'leather', tow: 'towing', 'self driving': 'autopilot', 'heated seat': 'heated seats', camera: 'backup camera', 'cruise': 'adaptive cruise' },
};
const SKIP_RE = /\b(no preference|don'?t (really )?care|doesn'?t matter|anything|any is fine|whatever|not sure|either|skip|none|nope)\b/i;
const SHOW_RE = /\b(show|recommend|suggest|options|what do you have|see (some )?cars)\b/i;

const STEPS = [
  { key: 'budget', has: (p) => p.budgetMax, q: "Happy to help! What's your budget, roughly?", chips: ['Under $25k', 'Up to $40k', 'Up to $60k'] },
  { key: 'type', has: (p) => p.types.length, q: 'What kind of car are you thinking of: SUV, sedan, pickup, something else?', chips: ['SUV', 'Sedan', 'Pickup', 'No preference'] },
  { key: 'fuel', has: (p) => p.fuels.length, q: 'Any fuel preference: electric, hybrid or petrol?', chips: ['Electric', 'Hybrid', 'Petrol', 'No preference'] },
  { key: 'extras', has: (p) => p.features.length || p.brands.length || p.seatsMin, q: 'Any must-haves? Features, a favourite brand, number of seats?', chips: ['AWD', 'Third row', 'Apple CarPlay', 'Show me cars'] },
];

function offlineTurn(conv) {
  const text = conv.messages.at(-1).text;
  const t = ` ${text.toLowerCase()} `;
  const p = { budgetMax: null, types: [], fuels: [], brands: [], features: [], seatsMin: null, notes: '', skipped: [], ...conv.prefs };
  const add = (list, v) => { if (!p[list].includes(v)) p[list].push(v); };

  const amounts = [...t.matchAll(/\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k\b|thousand)?/g)]
    .map(([, n, k]) => parseFloat(n.replace(/,/g, '')) * (k ? 1000 : 1))
    .filter((n) => n >= 5000);
  if (amounts.length) p.budgetMax = Math.max(...amounts);

  for (const [kind, map] of Object.entries(SYN)) {
    const vocab = Object.fromEntries(matcher.vocabulary[kind].map((v) => [v.toLowerCase(), v.toLowerCase()]));
    for (const [word, value] of Object.entries({ ...vocab, ...map })) {
      if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}`).test(t)) add(kind, value);
    }
  }
  if (p.fuels.includes('plug-in hybrid')) p.fuels = p.fuels.filter((f) => f !== 'hybrid');
  const seats = t.match(/(\d)\s*(seats?|seater|people|passengers|kids)/);
  if (seats) p.seatsMin = /kids/.test(seats[2]) ? Number(seats[1]) + 2 : Number(seats[1]);
  if (/\bbig family\b/.test(t)) p.seatsMin = Math.max(p.seatsMin || 0, 7);

  // "no preference" answers whatever we asked last
  const pending = STEPS.find((s) => !s.has(p) && !p.skipped.includes(s.key));
  if (pending && SKIP_RE.test(t) && !SHOW_RE.test(t)) p.skipped = [...p.skipped, pending.key];

  const next = STEPS.find((s) => !s.has(p) && !p.skipped.includes(s.key));
  const ready = SHOW_RE.test(t) || !next;
  return { prefs: p, ready, reply: next?.q, suggestions: next?.chips };
}

function offlinePitch(matches) {
  if (!matches.length) return "I couldn't find anything matching all of that. Could you stretch the budget or relax one requirement?";
  const why = ({ car, breakdown }) => {
    const hits = Object.entries(breakdown).filter(([c, v]) => v === 1 && c !== 'popularity').map(([c]) => c);
    return `${car.make} ${car.model} ($${car.price.toLocaleString()})${hits.length ? `, matches your ${hits.join(', ')}` : ''}`;
  };
  return `Here are my top picks for you: ${matches.map(why).join('; ')}. Tap 👍 or 👎 so I can learn what you like.`;
}

module.exports = { handleIncoming, respond, sendMatches };
