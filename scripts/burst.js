const http = require('http');

const FEE_URL = process.env.FEE_URL || 'http://localhost:4001';
const STUDENT_ID = process.env.STUDENT_ID || '1';
const COUNT = Number(process.env.COUNT || 20);
const AMOUNT = Number(process.env.AMOUNT || 1000);

const agent = new http.Agent({ keepAlive: true, maxSockets: COUNT + 5 });

function request(path, method, payload) {
  return new Promise((resolve) => {
    const target = new URL(path, FEE_URL);
    const body = payload ? Buffer.from(JSON.stringify(payload), 'utf8') : null;
    const headers = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = body.length;
    }
    const startedAt = Date.now();
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method,
        agent,
        headers
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
            parsed = { raw };
          }
          resolve({ status: res.statusCode, body: parsed, ms: Date.now() - startedAt });
        });
      }
    );
    req.on('error', (err) => resolve({ status: 0, body: { error: err.code }, ms: Date.now() - startedAt }));
    req.end(body);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== TINH HUONG 2: BAN CUNG LUC ' + COUNT + ' THANH TOAN ===');

  const startedAt = Date.now();
  const payments = Array.from({ length: COUNT }, () =>
    request('/students/' + STUDENT_ID + '/payments', 'POST', { amount: AMOUNT })
  );

  await sleep(800);
  console.log('\n--- GET /fees trong luc ' + COUNT + ' thanh toan dang cho ---');
  const feeTimes = [];
  for (let i = 0; i < 5; i++) {
    const res = await request('/students/' + STUDENT_ID + '/fees', 'GET', null);
    feeTimes.push(res.ms);
    console.log('  lan ' + (i + 1) + ': HTTP ' + res.status + ' trong ' + res.ms + 'ms');
    await sleep(150);
  }

  const results = await Promise.all(payments);
  const totalElapsed = Date.now() - startedAt;

  const byStatus = {};
  let slowest = 0;
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.ms > slowest) slowest = r.ms;
  }

  const slowestFee = Math.max(...feeTimes);

  console.log('\n--- KET QUA ---');
  console.log('Phan bo ma tra ve : ' + JSON.stringify(byStatus));
  console.log('Status nghiep vu  : ' + JSON.stringify(results[0] ? results[0].body.status : null));
  console.log('Thanh toan cham nhat: ' + slowest + 'ms');
  console.log('Tong thoi gian      : ' + totalElapsed + 'ms');
  console.log('GET /fees cham nhat : ' + slowestFee + 'ms');

  const pass = slowest <= 4500 && slowestFee < 300;
  console.log(pass ? '=> DAT YEU CAU' : '=> CHUA DAT');
  agent.destroy();
}

main();
