const http = require('http');

const FEE_URL = process.env.FEE_URL || 'http://localhost:4001';
const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';
const STUDENT_ID = process.env.STUDENT_ID || '1';
const TOTAL = Number(process.env.TOTAL || 60);
const AMOUNT = Number(process.env.AMOUNT || 1000);

const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

function request(url, method, payload) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const body = payload ? Buffer.from(JSON.stringify(payload), 'utf8') : null;
    const headers = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = body.length;
    }
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
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
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', (err) => resolve({ status: 0, body: { error: err.code || err.message } }));
    req.end(body);
  });
}

async function main() {
  const statsBefore = (await request(BANK_URL + '/stats', 'GET', null)).body;
  const feesBefore = (await request(FEE_URL + '/students/' + STUDENT_ID + '/fees', 'GET', null)).body;
  console.log('Stats truoc :', JSON.stringify(statsBefore));
  console.log('Cong no truoc:', feesBefore.debt);

  const counts = { paid: 0, pending: 0, failed: 0 };
  let maxDuration = 0;
  const startedAt = Date.now();

  for (let i = 0; i < TOTAL; i++) {
    const res = await request(FEE_URL + '/students/' + STUDENT_ID + '/payments', 'POST', { amount: AMOUNT });
    const duration = res.body && res.body.durationMs ? res.body.durationMs : 0;
    if (duration > maxDuration) maxDuration = duration;
    if (res.status === 201) counts.paid++;
    else if (res.status === 504) counts.pending++;
    else counts.failed++;
  }

  const elapsed = Date.now() - startedAt;
  const statsAfter = (await request(BANK_URL + '/stats', 'GET', null)).body;
  const feesAfter = (await request(FEE_URL + '/students/' + STUDENT_ID + '/fees', 'GET', null)).body;

  console.log('\n--- KET QUA ' + TOTAL + ' THANH TOAN ---');
  console.log('PAID    : ' + counts.paid);
  console.log('PENDING : ' + counts.pending);
  console.log('FAILED  : ' + counts.failed);
  console.log('Tong thoi gian : ' + elapsed + 'ms');
  console.log('Lau nhat 1 lenh: ' + maxDuration + 'ms');
  console.log('Stats sau: ' + JSON.stringify(statsAfter));
  console.log('duplicates     : ' + statsAfter.duplicates);
  console.log('Cong no giam   : ' + (feesBefore.debt - feesAfter.debt));
  console.log('Dung ra phai la: ' + counts.paid * AMOUNT);

  const pass =
    statsAfter.duplicates === 0 &&
    counts.paid >= Math.ceil(TOTAL * 0.9) &&
    feesBefore.debt - feesAfter.debt === counts.paid * AMOUNT &&
    maxDuration <= 4500;
  console.log(pass ? '=> DAT YEU CAU' : '=> CHUA DAT');
  agent.destroy();
}

main();
