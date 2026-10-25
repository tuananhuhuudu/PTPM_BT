const http = require('http');
const { URL } = require('url');

const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';

function callBank(payload) {
  return new Promise((resolve, reject) => {
    const target = new URL('/charges', BANK_URL);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');

    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname,
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          Connection: 'close'
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
      }
    );

    req.on('error', (err) => reject(err));
    req.end(body);
  });
}

async function charge(reference, amount) {
  try {
    const result = await callBank({ reference, amount });
    if (result.status >= 200 && result.status < 300) {
      return { outcome: 'CHARGED', status: result.status, body: result.body, attempts: 1 };
    }
    if (result.status >= 400 && result.status < 500) {
      return { outcome: 'REJECTED', status: result.status, body: result.body, attempts: 1 };
    }
    return { outcome: 'UNKNOWN', message: 'Ngan hang loi ' + result.status, attempts: 1 };
  } catch (err) {
    const code = err.code || '';
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      return { outcome: 'UNREACHABLE', message: 'Khong ket noi duoc', attempts: 1 };
    }
    return { outcome: 'UNKNOWN', message: 'Dut ket noi', attempts: 1 };
  }
}

module.exports = { charge, BANK_URL, TOTAL_BUDGET_MS: 0, MAX_SOCKETS: 0 };
