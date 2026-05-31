/**
 * AURA — local dev server + Claude AI proxy
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node server.js
 *
 * Or create a .env file in the same folder:
 *   ANTHROPIC_API_KEY=sk-ant-...
 *
 * Then open http://localhost:5500 in your browser.
 *
 * The server does two things:
 *   1. Serves all static files (HTML, JS, CSS, CSV) from this folder.
 *   2. Proxies POST /api/claude → Anthropic API, injecting your key
 *      server-side so the browser never needs to know it.
 *
 * No npm install needed — uses only Node.js built-ins.
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

// ── Load .env file if present ─────────────────────────────────────────────────
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
})();

const PORT         = Number(process.env.PORT) || 5500;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

if (!ANTHROPIC_KEY) {
  console.warn('\n⚠  WARNING: ANTHROPIC_API_KEY is not set.');
  console.warn('   The /api/claude proxy will return 401 errors.');
  console.warn('   Set it in a .env file or as an environment variable.\n');
}

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.csv' : 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ── Claude proxy ──────────────────────────────────────────────────────────────
function proxyToClaude(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    // Validate it's JSON
    let parsed;
    try { parsed = JSON.parse(body); }
    catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    // Always use Sonnet 4 and cap tokens
    parsed.model      = parsed.model      || 'claude-sonnet-4-20250514';
    parsed.max_tokens = parsed.max_tokens || 1000;

    const payload = JSON.stringify(parsed);

    const options = {
      hostname: 'api.anthropic.com',
      port    : 443,
      path    : '/v1/messages',
      method  : 'POST',
      headers : {
        'Content-Type'     : 'application/json',
        'Content-Length'   : Buffer.byteLength(payload),
        'x-api-key'        : ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
    };

    const proxyReq = https.request(options, proxyRes => {
      let data = '';
      proxyRes.on('data', chunk => { data += chunk; });
      proxyRes.on('end', () => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type' : 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      });
    });

    proxyReq.on('error', err => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }));
    });

    proxyReq.write(payload);
    proxyReq.end();
  });
}

// ── Static file server ────────────────────────────────────────────────────────
function serveStatic(req, res) {
  let pathname = url.parse(req.url).pathname;
  if (pathname === '/' || pathname === '') pathname = '/aura__4_.html';

  const filePath = path.join(__dirname, pathname);

  // Security: only serve files inside the project folder
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${pathname}`);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

// ── Main request handler ──────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin' : '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/claude') {
    proxyToClaude(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n✅  AURA dev server running`);
  console.log(`   Open → http://localhost:${PORT}`);
  console.log(`   Claude proxy → POST http://localhost:${PORT}/api/claude`);
  console.log(`   API key: ${ANTHROPIC_KEY ? '✅ loaded' : '❌ NOT SET — add ANTHROPIC_API_KEY to .env'}\n`);
});

