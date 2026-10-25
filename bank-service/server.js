const express = require('express');

const PORT = Number(process.env.PORT || 4002);
const DELAY_MS = Number(process.env.DELAY_MS || 0);
const FAIL_RATE = Number(process.env.FAIL_RATE || 0);
const DROP_RATE = Number(process.env.DROP_RATE || 0);
const LIMIT = 20000000;

const app = express();
app.use(express.json());

const stats = { connections: 0, requests: 0, charges: 0, duplicates: 0 };

const byKey = new Map();
const chargedRefs = new Set();
let chargeSeq = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.use((req, res, next) => {
  stats.requests++;
  next();
});

app.get('/stats', (req, res) => {
  res.json(stats);
});

app.post('/charges', async (req, res) => {
  const { reference, amount } = req.body || {};
  const key = req.get('Idempotency-Key');

  if (key && byKey.has(key)) {
    return res.status(200).json(byKey.get(key));
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'INVALID_AMOUNT' });
  }
  if (typeof reference !== 'string' || reference.trim() === '') {
    return res.status(400).json({ error: 'INVALID_REFERENCE' });
  }
  if (amount > LIMIT) {
    return res.status(402).json({ error: 'LIMIT_EXCEEDED', limit: LIMIT });
  }

  if (DELAY_MS > 0) {
    await sleep(DELAY_MS);
  }

  if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
    return res.status(500).json({ error: 'BANK_TEMPORARY_ERROR' });
  }

  chargeSeq++;
  const charge = {
    chargeId: 'CH' + chargeSeq,
    reference,
    amount,
    status: 'CHARGED',
    chargedAt: new Date().toISOString()
  };

  stats.charges++;
  if (chargedRefs.has(reference)) {
    stats.duplicates++;
    console.log('[bank] TRU TIEN TRUNG reference=' + reference);
  }
  chargedRefs.add(reference);

  if (key) {
    byKey.set(key, charge);
  }

  if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
    console.log('[bank] da tru ' + charge.chargeId + ' roi cat ket noi');
    req.socket.destroy();
    return;
  }

  res.status(201).json(charge);
});

const server = app.listen(PORT, () => {
  console.log('[bank] chay tai http://localhost:' + PORT);
  console.log('[bank] DELAY_MS=' + DELAY_MS + ' FAIL_RATE=' + FAIL_RATE + ' DROP_RATE=' + DROP_RATE);
});

server.keepAliveTimeout = 5000;
server.headersTimeout = 10000;

server.on('connection', (socket) => {
  stats.connections++;
  console.log('[bank] ket noi TCP moi #' + stats.connections + ' (port ' + socket.remotePort + ')');
});
