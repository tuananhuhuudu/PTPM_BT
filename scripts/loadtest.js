const http = require('http');

const FEE_URL = process.env.FEE_URL || 'http://localhost:4001';
const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';
const STUDENT_ID = process.env.STUDENT_ID || '1';
const TOTAL = Number(process.env.TOTAL || 200);
const CONCURRENCY = Number(process.env.CONCURRENCY || 10);
const AMOUNT = Number(process.env.AMOUNT || 1000);

const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY });

function requestOnce(url, method, payload) {
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

async function request(url, method, payload) {
  let res = await requestOnce(url, method, payload);
  let tries = 0;
  while (res.status === 0 && tries < 3) {
    tries++;
    res = await requestOnce(url, method, payload);
  }
  if (res.status === 0) {
    console.log('  [script] that bai sau ' + tries + ' lan thu lai: ' + JSON.stringify(res.body));
  }
  return res;
}

async function getStats() {
  const res = await request(BANK_URL + '/stats', 'GET', null);
  return res.body;
}

async function runBatch(count, label) {
  const results = { ok: 0, pending: 0, failed: 0, other: 0 };
  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= count) return;
      const res = await request(FEE_URL + '/students/' + STUDENT_ID + '/payments', 'POST', { amount: AMOUNT });
      if (res.status === 201) results.ok++;
      else if (res.status === 504) results.pending++;
      else {
        results.failed++;
        console.log('  [' + label + '] that bai: status=' + res.status + ' ' + JSON.stringify(res.body));
      }
    }
  }

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, count) }, worker));
  const elapsed = Date.now() - startedAt;

  console.log(
    '[' + label + '] ' + count + ' yeu cau trong ' + elapsed + 'ms | thanh cong=' + results.ok +
      ' pending=' + results.pending + ' that bai=' + results.failed
  );
  return { elapsed, results };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== TINH HUONG 3: DUY TRI KET NOI ===');
  const before = await getStats();
  console.log('Stats truoc:', JSON.stringify(before));

  const main1 = await runBatch(TOTAL, 'batch-chinh');

  const afterMain = await getStats();
  console.log('Stats sau batch chinh:', JSON.stringify(afterMain));
  console.log('So ket noi TCP ngan hang da mo them: ' + (afterMain.connections - before.connections));

  console.log('\nCho nhan roi 6 giay de ngan hang dong ket noi cu...');
  await sleep(6000);

  const main2 = await runBatch(5, 'sau-nhan-roi');
  const afterIdle = await getStats();
  console.log('Stats cuoi:', JSON.stringify(afterIdle));

  console.log('\n--- KET LUAN ---');
  console.log('Thanh cong batch chinh : ' + main1.results.ok + '/' + TOTAL);
  console.log('Tong thoi gian         : ' + main1.elapsed + 'ms');
  console.log('Ket noi TCP tieu ton   : ' + (afterIdle.connections - before.connections));
  console.log('Thanh cong sau nhan roi: ' + main2.results.ok + '/5');
  console.log('duplicates             : ' + afterIdle.duplicates);

  const pass =
    main1.results.ok === TOTAL &&
    afterIdle.connections - before.connections <= 20 &&
    main2.results.ok === 5 &&
    afterIdle.duplicates === 0;
  console.log(pass ? '=> DAT YEU CAU' : '=> CHUA DAT');
  agent.destroy();
}

main();
