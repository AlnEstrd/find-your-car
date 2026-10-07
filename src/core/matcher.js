// Car matching model: a transparent weighted score that learns from feedback.
//
//   score(car) = Σ weight_c · match_c(car)  /  Σ weight_c      (only criteria the user expressed)
//
// Each criterion returns 0..1. "popularity" is a learned per-car boost that
// moves with 👍 / 👎 feedback. Weights themselves can be tuned live from the
// agent console, or nudged automatically by feedback (if autoLearn is on).

const fs = require('node:fs');
const path = require('node:path');
const dealers = require('./dealers');

const CARS_FILE = path.join(__dirname, '../../data/cars.json');
const MODEL_FILE = path.join(__dirname, '../../data/model.json');

const DEFAULT_MODEL = {
  weights: { budget: 3, type: 2, fuel: 2, brand: 1, features: 1.5, seats: 2, popularity: 0.5 },
  budgetTolerance: 0.15, // allow cars up to 15% over budget (with a falling score)
  autoLearn: true,
  learningRate: 0.1,
  boosts: {},            // carId -> -1..1
  feedback: [],          // recent feedback log (shown in the agent console)
};

const cars = JSON.parse(fs.readFileSync(CARS_FILE, 'utf8'));
let model = load();

function load() {
  try {
    return { ...structuredClone(DEFAULT_MODEL), ...JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8')) };
  } catch {
    return structuredClone(DEFAULT_MODEL);
  }
}

function save() {
  fs.writeFileSync(MODEL_FILE, JSON.stringify(model, null, 2));
}

const lower = (xs) => (xs || []).map((x) => String(x).toLowerCase());
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Returns { criterion: 0..1 } for every criterion the user actually expressed.
function criteriaScores(car, prefs) {
  const s = {};
  if (prefs.budgetMax) {
    const over = (car.price - prefs.budgetMax) / prefs.budgetMax;
    s.budget = over <= 0 ? 1 : clamp(1 - over / model.budgetTolerance, 0, 1);
  }
  const types = lower(prefs.types);
  if (types.length) s.type = types.includes(car.type) ? 1 : 0;
  const fuels = lower(prefs.fuels);
  if (fuels.length) {
    // A plug-in hybrid half-satisfies someone asking for "hybrid" or "electric".
    s.fuel = fuels.includes(car.fuel) ? 1
      : car.fuel === 'plug-in hybrid' && (fuels.includes('hybrid') || fuels.includes('electric')) ? 0.5 : 0;
  }
  const brands = lower(prefs.brands);
  if (brands.length) s.brand = brands.includes(car.make.toLowerCase()) ? 1 : 0;
  const feats = lower(prefs.features);
  if (feats.length) s.features = feats.filter((f) => car.features.includes(f)).length / feats.length;
  if (prefs.seatsMin) s.seats = car.seats >= prefs.seatsMin ? 1 : 0;
  s.popularity = ((model.boosts[car.id] || 0) + 1) / 2;
  return s;
}

function scoreCar(car, prefs) {
  const parts = criteriaScores(car, prefs);
  let num = 0, den = 0;
  for (const [c, v] of Object.entries(parts)) {
    const w = model.weights[c] ?? 0;
    num += w * v;
    den += w;
  }
  return { score: den ? Math.round((num / den) * 100) : 0, breakdown: parts };
}

function rank(prefs = {}, limit = 3) {
  return cars
    .filter((car) => dealers.isActive(car.dealerId))
    .filter((car) => !prefs.budgetMax || car.price <= prefs.budgetMax * (1 + model.budgetTolerance))
    .filter((car) => !(prefs.excludeIds || []).includes(car.id))
    .map((car) => ({ car, dealer: dealers.get(car.dealerId), ...scoreCar(car, prefs) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// 👍 / 👎 on a recommended car. Nudges the car's boost and, if autoLearn is on,
// the weights: criteria the liked car satisfied matter a bit more, criteria it
// missed matter a bit less (and the reverse for a 👎). Simple, but it adapts.
function feedback({ carId, liked, prefs = {}, source = 'consumer', conversationId }) {
  const car = cars.find((c) => c.id === carId);
  if (!car) return null;
  const lr = model.learningRate;
  const sign = liked ? 1 : -1;
  model.boosts[carId] = clamp((model.boosts[carId] || 0) + sign * lr * 2, -1, 1);

  if (model.autoLearn) {
    for (const [c, v] of Object.entries(criteriaScores(car, prefs))) {
      if (c === 'popularity') continue;
      const delta = sign * lr * (v - 0.5); // satisfied → +, missed → −
      model.weights[c] = Math.round(clamp(model.weights[c] + delta, 0.1, 5) * 100) / 100;
    }
  }
  model.feedback.unshift({ carId, car: `${car.make} ${car.model}`, liked, source, conversationId, at: Date.now() });
  model.feedback = model.feedback.slice(0, 50);
  save();
  return model;
}

function getModel() {
  return model;
}

function updateModel(patch) {
  if (patch.weights) {
    for (const [k, v] of Object.entries(patch.weights)) {
      if (k in model.weights) model.weights[k] = clamp(Number(v), 0, 5);
    }
  }
  if ('autoLearn' in patch) model.autoLearn = !!patch.autoLearn;
  if ('budgetTolerance' in patch) model.budgetTolerance = clamp(Number(patch.budgetTolerance), 0, 0.5);
  save();
  return model;
}

function resetModel() {
  model = structuredClone(DEFAULT_MODEL);
  save();
  return model;
}

// Vocabulary the LLM (and the offline parser) should map user wording onto.
const vocabulary = {
  types: [...new Set(cars.map((c) => c.type))],
  fuels: [...new Set(cars.map((c) => c.fuel))],
  brands: [...new Set(cars.map((c) => c.make))],
  features: [...new Set(cars.flatMap((c) => c.features))],
};

module.exports = { cars, rank, scoreCar, feedback, getModel, updateModel, resetModel, vocabulary };
