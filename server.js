const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const METRICS_FILE = path.join(ROOT, 'metrics.json');

function todayKey(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultMetrics() {
  return { dias: {} };
}

function readMetrics() {
  try {
    if (!fs.existsSync(METRICS_FILE)) return defaultMetrics();
    const raw = fs.readFileSync(METRICS_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    if (!parsed.dias) parsed.dias = {};
    return parsed;
  } catch (err) {
    return defaultMetrics();
  }
}

function writeMetrics(metrics) {
  fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), 'utf8');
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json' || ext === '.geojson') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

function safeFilePath(requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\//, '');
  const filePath = path.normalize(path.join(ROOT, relative));
  const rel = path.relative(ROOT, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return filePath;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function ensureDay(metrics, key) {
  if (!metrics.dias[key]) metrics.dias[key] = { ingresos: 0, exportaciones: 0 };
  return metrics.dias[key];
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (parsedUrl.pathname === '/api/metrics' && req.method === 'GET') {
    return sendJson(res, 200, readMetrics());
  }

  if (parsedUrl.pathname === '/api/metrics' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const tipo = payload.tipo;
      if (tipo !== 'ingreso' && tipo !== 'exportacion') {
        return sendJson(res, 400, { ok: false, error: 'tipo invalido' });
      }

      const metrics = readMetrics();
      const key = todayKey();
      const day = ensureDay(metrics, key);
      if (tipo === 'ingreso') day.ingresos += 1;
      if (tipo === 'exportacion') day.exportaciones += 1;
      writeMetrics(metrics);
      return sendJson(res, 200, { ok: true, ...metrics });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: 'no se pudo guardar la metrica' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Method Not Allowed');
  }

  const filePath = safeFilePath(parsedUrl.pathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const indexPath = path.join(ROOT, 'index.html');
      fs.readFile(indexPath, (indexErr, indexData) => {
        if (indexErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(indexData);
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    if (req.method === 'HEAD') return res.end();
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`mapa-clientes listening on http://localhost:${PORT}`);
});
