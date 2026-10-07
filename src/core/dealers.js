// Dealers: who sells each car. Admins can add, edit, block or remove dealers
// from the console. Cars from blocked dealers are never recommended and their
// public page shows as unavailable. Starts from data/dealers.seed.json; changes
// are saved to data/dealers.json (git-ignored; `npm run reset` restores the seed).

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '../../data/dealers.json');
const SEED = path.join(__dirname, '../../data/dealers.seed.json');
let dealers = JSON.parse(fs.readFileSync(fs.existsSync(FILE) ? FILE : SEED, 'utf8'));

const save = () => fs.writeFileSync(FILE, JSON.stringify(dealers, null, 2));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const FIELDS = ['name', 'city', 'phone', 'email', 'description', 'status'];
const pick = (o) => Object.fromEntries(FIELDS.filter((k) => k in o).map((k) => [k, String(o[k]).trim()]));

const list = () => dealers;
const get = (id) => dealers.find((d) => d.id === id);
const isActive = (id) => get(id)?.status === 'active';

function add(data) {
  if (!data.name?.trim()) throw new Error('name is required');
  let id = slug(data.name);
  while (get(id)) id += '-2';
  const dealer = { id, city: '', phone: '', email: '', description: '', status: 'active', ...pick(data) };
  dealers.push(dealer);
  save();
  return dealer;
}

function update(id, patch) {
  const dealer = get(id);
  if (!dealer) return null;
  Object.assign(dealer, pick(patch));
  if (!['active', 'blocked'].includes(dealer.status)) dealer.status = 'active';
  save();
  return dealer;
}

function remove(id) {
  const before = dealers.length;
  dealers = dealers.filter((d) => d.id !== id);
  save();
  return dealers.length < before;
}

module.exports = { list, get, isActive, add, update, remove };
