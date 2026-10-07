// Tiny HTTP helpers so the app runs on plain Node with zero dependencies.

const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '../public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try { return body ? JSON.parse(body) : {}; } catch { return {}; }
}

// Opens a Server-Sent Events stream and returns send(event, data).
function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => clearInterval(ping));
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function json(res) {
  return (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
}

function serveStatic(res, pathname) {
  const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

module.exports = { readJson, sse, json, serveStatic };
