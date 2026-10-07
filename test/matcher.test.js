// Run with `npm test`. Note: resets runtime data (same as `npm run reset`).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

for (const f of ['data/model.json', 'data/dealers.json']) fs.rmSync(f, { force: true });
const matcher = require('../src/core/matcher');
const dealers = require('../src/core/dealers');
test.after(() => { for (const f of ['data/model.json', 'data/dealers.json']) fs.rmSync(f, { force: true }); });

test('ranks cars that satisfy every stated criterion first', () => {
  const [top] = matcher.rank({ budgetMax: 35000, types: ['suv'], fuels: ['hybrid'] });
  assert.equal(top.car.type, 'suv');
  assert.equal(top.car.fuel, 'hybrid');
  assert.ok(top.car.price <= 35000);
});

test('never recommends cars far above budget', () => {
  for (const { car } of matcher.rank({ budgetMax: 25000 }, 10)) assert.ok(car.price <= 25000 * 1.15);
});

test('blocked dealers are excluded', () => {
  const ev = () => matcher.rank({ fuels: ['electric'] }, 50).map((m) => m.car.dealerId);
  assert.ok(ev().includes('volt-auto'));
  dealers.update('volt-auto', { status: 'blocked' });
  assert.ok(!ev().includes('volt-auto'));
  dealers.update('volt-auto', { status: 'active' });
});

test('positive feedback boosts a car and its matching criteria', () => {
  const prefs = { budgetMax: 40000, types: ['suv'] };
  const before = { ...matcher.getModel().weights };
  matcher.feedback({ carId: 'honda-crv', liked: true, prefs });
  const m = matcher.getModel();
  assert.ok(m.boosts['honda-crv'] > 0);
  assert.ok(m.weights.type > before.type);
});
