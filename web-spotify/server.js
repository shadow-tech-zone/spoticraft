/* ═══════════════════════════════════════════════════════════════
   Bloomee Web — local dev server (zero dependencies)
   Static files + /api/* (Vercel serverless functions ko locally
   chalata hai). Production mein yehi api/ folder Vercel par
   functions ban jati hai.

   Chalao:  node server.js        (http://localhost:8000)
   ═══════════════════════════════════════════════════════════════ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 8000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function adaptRes(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => {
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  /* /api/* → api/*.js handlers */
  if (pathname.startsWith('/api/')) {
    const name = pathname.slice(5).split('/')[0];
    if (!/^[a-z-]+$/.test(name)) { res.statusCode = 404; return res.end('{"error":"not found"}'); }
    const file = path.join(ROOT, 'api', name + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"not found"}'); }
    try {
      const fn = require(file);
      req.query = Object.fromEntries(url.searchParams.entries());
      await fn(req, adaptRes(res));
    } catch (e) {
      if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); }
      res.end(JSON.stringify({ error: 'Local API error', detail: String(e && e.message || e) }));
    }
    return;
  }

  /* static files */
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.statusCode = 404; res.setHeader('Content-Type', 'text/plain');
    return res.end('404 — Not found');
  }
  res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bloomee Web chal raha hai → http://localhost:${PORT}  (static + /api backend)`);
});
