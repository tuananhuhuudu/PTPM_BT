const http = require('http');
const { URL } = require('url');

const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';
const TOTAL_BUDGET_MS = Number(process.env.TOTAL_BUDGET_MS || 4300);
const ATTEMPT_TIMEOUT_MS = Number(process.env.ATTEMPT_TIMEOUT_MS || 1200);
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS || 1000);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 3);
const MAX_SOCKETS = Number(process.env.MAX_SOCKETS || 10);

const agent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: MAX_SOCKETS,
  maxFreeSockets: MAX_SOCKETS
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class BankError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function callBank(payload, key, timeoutMs) {
  return new Promise((resolveRaw, rejectRaw) => {
    let done = false;
    let timer = null;

    const resolve = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveRaw(value);
    };
    const reject = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      rejectRaw(err);
    };

    const target = new URL('/charges', BANK_URL);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');

    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname,
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          'Idempotency-Key': key,
          Connection: 'keep-alive'
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch (err) {
            parsed = null;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
        res.on('aborted', () => reject(new BankError('DROPPED', 'Dut ket noi khi dang doc phan hoi')));
      }
    );

    timer = setTimeout(() => {
      req.destroy(new BankError('TIMEOUT', 'Het thoi gian cho ngan hang'));
    }, timeoutMs);

    req.on('socket', (socket) => {
      if (!socket.connecting) return;
      const connectTimer = setTimeout(() => {
        req.destroy(new BankError('UNREACHABLE', 'Khong ket noi duoc toi ngan hang'));
      }, Math.min(CONNECT_TIMEOUT_MS, timeoutMs));
      socket.once('connect', () => clearTimeout(connectTimer));
      req.once('close', () => clearTimeout(connectTimer));
    });

    req.on('error', (err) => {
      if (err instanceof BankError) return reject(err);
      const code = err.code || '';
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
        return reject(new BankError('UNREACHABLE', 'Khong ket noi duoc toi ngan hang'));
      }
      if (code === 'ETIMEDOUT') {
        return reject(new BankError('TIMEOUT', 'Het thoi gian cho ngan hang'));
      }
      if ((code === 'ECONNRESET' || code === 'EPIPE') && req.reusedSocket) {
        return reject(new BankError('STALE_SOCKET', 'Ket noi nhan roi da bi dong'));
      }
      return reject(new BankError('DROPPED', 'Dut ket noi khi dang cho tra loi'));
    });

    req.end(body);
  });
}

async function charge(reference, amount, key) {
  const startedAt = Date.now();
  let attempt = 0;
  let staleRetries = 0;
  let lastError = null;

  while (attempt < MAX_RETRIES) {
    attempt++;
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 50) break;

    try {
      const result = await callBank({ reference, amount }, key, Math.min(ATTEMPT_TIMEOUT_MS, remaining));

      if (result.status >= 200 && result.status < 300) {
        return { outcome: 'CHARGED', status: result.status, body: result.body, attempts: attempt };
      }
      if (result.status >= 400 && result.status < 500) {
        return { outcome: 'REJECTED', status: result.status, body: result.body, attempts: attempt };
      }
      lastError = new BankError('SERVER_ERROR', 'Ngan hang loi ' + result.status);
    } catch (err) {
      lastError = err;
      if (err.kind === 'STALE_SOCKET' && staleRetries < 2) {
        attempt--;
        staleRetries++;
        continue;
      }
      if (err.kind === 'UNREACHABLE' && attempt >= 2) break;
    }

    const waitMs = Math.min(120 * Math.pow(2, attempt - 1), 500) + Math.floor(Math.random() * 60);
    if (Date.now() - startedAt + waitMs >= TOTAL_BUDGET_MS) break;
    await sleep(waitMs);
  }

  const kind = lastError ? lastError.kind : 'TIMEOUT';
  const message = lastError ? lastError.message : 'Khong ro ket qua tu ngan hang';
  if (kind === 'UNREACHABLE' || kind === 'STALE_SOCKET') {
    return { outcome: 'UNREACHABLE', message, attempts: attempt };
  }
  return { outcome: 'UNKNOWN', message, attempts: attempt };
}

module.exports = { charge, BANK_URL, TOTAL_BUDGET_MS, MAX_SOCKETS };
