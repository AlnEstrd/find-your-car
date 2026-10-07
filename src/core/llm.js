// Thin client for CodeMie's OpenAI-compatible chat completions endpoint.
// Any OpenAI-compatible gateway works by changing the env vars.
// With no API key configured, it returns null and the assistant falls back to
// its offline rule-based parser, so the demo still runs without network access.

const BASE_URL = (process.env.CODEMIE_API_URL || '').replace(/\/$/, '');
const API_KEY = process.env.CODEMIE_API_KEY || '';
const MODEL = process.env.CODEMIE_MODEL || 'gpt-4o';

const enabled = () => Boolean(BASE_URL && API_KEY);

async function chat(messages, { temperature = 0.3 } = {}) {
  if (!enabled()) return null;
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// Models sometimes wrap JSON in prose or ``` fences; grab the outermost object.
function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in LLM reply');
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = { chat, parseJson, enabled, model: MODEL };
