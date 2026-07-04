/**
 * Drogueria JYM 2 — Servidor de produccion v3
 * Soporta: Railway, Render, Fly.io, VPS, red local
 * WS sobre la misma conexion HTTP (compatible con proxies)
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { WebSocketServer } = require('ws');

const PORT    = process.env.PORT || 3000;
const PUBLIC  = path.join(__dirname, 'public');
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// ── Base de datos en memoria ─────────────────────────────────────────────────
let db = { inventario: [], ventas: [], numeroFactura: 1 };

function dbDemo() {
  return {
    inventario: [
      { id: uid(), nombre: 'Paracetamol 500mg x10',  cantidad: 20, precio: 320,   codigo: '' },
      { id: uid(), nombre: 'Ibuprofeno 400mg x10',   cantidad: 12, precio: 420,   codigo: '' },
      { id: uid(), nombre: 'Amoxicilina 500mg x7',   cantidad: 5,  precio: 2200,  codigo: '' },
      { id: uid(), nombre: 'Jarabe Tos 120ml',        cantidad: 8,  precio: 1250,  codigo: '' },
      { id: uid(), nombre: 'Loratadina 10mg x10',    cantidad: 15, precio: 580,   codigo: '' }
    ],
    ventas: [],
    numeroFactura: 1
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function cargarDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(raw);
      // Migrar items sin id
      db.inventario = db.inventario.map(i => ({ id: i.id || uid(), ...i }));
      console.log(`[DB] Cargado: ${db.inventario.length} productos, ${db.ventas.length} ventas`);
    } else {
      db = dbDemo();
      guardarDB();
      console.log('[DB] Datos demo creados');
    }
  } catch (e) {
    console.error('[DB] Error cargando, usando demo:', e.message);
    db = dbDemo();
  }
}

// Escritura async con debounce — nunca bloquea el WS
let _saveTimer = null;
function guardarDB() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
      fs.writeFile(DB_FILE, JSON.stringify(db), err => {
        if (err) console.error('[DB] Error guardando:', err.message);
      });
    } catch(e) { console.error('[DB] Error:', e.message); }
  }, 300);
}

cargarDB();

// ── HTTP ──────────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // API
  if (url === '/api/db' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(db));
  }

  if (url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, productos: db.inventario.length, ts: Date.now() }));
  }

  // Archivos estáticos
  const rel  = url === '/' ? '/index.html' : url;
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext  = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=3600'
    });
    res.end(data);
  });
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, perMessageDeflate: false });
const clients = new Set();

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(obj, skip) {
  const msg = JSON.stringify(obj);
  clients.forEach(c => { if (c !== skip && c.readyState === 1) c.send(msg); });
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  clients.add(ws);
  ws.isAlive = true;
  console.log(`[WS] + ${ip}  (${clients.size} conectados)`);

  // Enviar estado actual inmediatamente
  send(ws, { t: 'db', db });

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    switch (m.t) {

      // PRIORIDAD MAXIMA — codigo escaneado, reenvio instantaneo
      case 'scan':
        broadcast({ t: 'scan', codigo: m.codigo, ts: m.ts }, ws);
        break;

      // Nuevo producto
      case 'inv_add': {
        const item = { id: uid(), ...m.item };
        db.inventario.push(item);
        guardarDB();
        broadcast({ t: 'inv_add', item }, ws);
        break;
      }

      // Actualizar producto existente
      case 'inv_update': {
        const idx = db.inventario.findIndex(i => i.id === m.item.id);
        if (idx >= 0) {
          db.inventario[idx] = { ...db.inventario[idx], ...m.item };
          guardarDB();
          broadcast({ t: 'inv_update', item: db.inventario[idx] }, ws);
        }
        break;
      }

      // Eliminar producto
      case 'inv_delete': {
        db.inventario = db.inventario.filter(i => i.id !== m.id);
        guardarDB();
        broadcast({ t: 'inv_delete', id: m.id }, ws);
        break;
      }

      // Registrar venta
      case 'venta': {
        db.ventas.push(m.venta);
        db.numeroFactura = m.numeroFactura;
        // Descontar stock
        m.venta.items.forEach(vi => {
          const prod = db.inventario.find(i => i.id === vi.id || i.nombre === vi.nombre);
          if (prod) prod.cantidad = Math.max(0, prod.cantidad - vi.cantidad);
        });
        guardarDB();
        broadcast({ t: 'venta', venta: m.venta, numeroFactura: m.numeroFactura, inventario: db.inventario }, ws);
        send(ws, { t: 'inv_sync', inventario: db.inventario }); // confirmar stock actualizado al emisor
        break;
      }

      // Solicitar DB completa
      case 'get_db':
        send(ws, { t: 'db', db });
        break;

      case 'ping':
        send(ws, { t: 'pong', ts: Date.now() });
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] - ${ip}  (${clients.size} conectados)`);
  });

  ws.on('error', e => console.error('[WS] Error:', e.message));
});

// Heartbeat — detecta conexiones muertas en WiFi inestable
setInterval(() => {
  clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); clients.delete(ws); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 20000);

// ── Arranque ──────────────────────────────────────────────────────────────────
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  const pad = s => s.padEnd(34);
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Drogueria JYM 2  —  Servidor v3           ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Local  → ${pad('http://localhost:' + PORT)}║`);
  console.log(`║  Red    → ${pad('http://' + ip + ':' + PORT)}║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Ctrl+C para detener                        ║');
  console.log('╚══════════════════════════════════════════════╝\n');
});
