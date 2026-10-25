const express = require('express');

const NAIVE = process.env.NAIVE === '1';
const bankClient = NAIVE ? require('./bankClientNaive') : require('./bankClient');

const PORT = Number(process.env.PORT || 4001);

const app = express();
app.use(express.json());

const students = new Map([
  ['1', { id: '1', name: 'Nguyen Van A', debt: 50000000, holding: 0 }],
  ['2', { id: '2', name: 'Tran Thi B', debt: 0, holding: 0 }],
  ['3', { id: '3', name: 'Le Van C', debt: 3200000, holding: 0 }]
]);

const payments = new Map();
let paymentSeq = 0;

app.get('/students/:id/fees', (req, res) => {
  const student = students.get(req.params.id);
  if (!student) {
    return res.status(404).json({ error: 'STUDENT_NOT_FOUND' });
  }
  res.json({ studentId: student.id, name: student.name, debt: student.debt, currency: 'VND' });
});

app.get('/payments/:paymentId', (req, res) => {
  const payment = payments.get(req.params.paymentId);
  if (!payment) {
    return res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });
  }
  res.json(payment);
});

app.post('/students/:id/payments', async (req, res) => {
  const student = students.get(req.params.id);
  if (!student) {
    return res.status(404).json({ error: 'STUDENT_NOT_FOUND', paymentId: null, status: 'FAILED' });
  }

  const amount = req.body ? req.body.amount : undefined;

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'INVALID_AMOUNT', paymentId: null, status: 'FAILED' });
  }

  if (amount > student.debt - student.holding) {
    return res.status(400).json({
      error: 'AMOUNT_EXCEEDS_DEBT',
      message: 'So tien vuot qua cong no con lai',
      paymentId: null,
      status: 'FAILED'
    });
  }

  paymentSeq++;
  const paymentId = 'P' + paymentSeq;
  const payment = {
    paymentId,
    studentId: student.id,
    amount,
    status: 'PROCESSING',
    chargeId: null,
    attempts: 0,
    createdAt: new Date().toISOString()
  };
  payments.set(paymentId, payment);

  student.holding += amount;

  const startedAt = Date.now();
  let result;
  try {
    result = await bankClient.charge(paymentId, amount, paymentId);
  } finally {
    student.holding -= amount;
  }

  payment.attempts = result.attempts;
  payment.durationMs = Date.now() - startedAt;

  if (result.outcome === 'CHARGED') {
    student.debt -= amount;
    payment.status = 'PAID';
    payment.chargeId = result.body ? result.body.chargeId : null;
    payment.paidAt = new Date().toISOString();
    return res.status(201).json({
      paymentId,
      studentId: student.id,
      amount,
      status: 'PAID',
      chargeId: payment.chargeId,
      remainingDebt: student.debt,
      attempts: payment.attempts,
      durationMs: payment.durationMs
    });
  }

  if (result.outcome === 'REJECTED') {
    payment.status = 'FAILED';
    payment.error = result.body && result.body.error ? result.body.error : 'BANK_REJECTED';
    return res.status(result.status).json({
      error: payment.error,
      paymentId,
      status: 'FAILED',
      remainingDebt: student.debt,
      attempts: payment.attempts,
      durationMs: payment.durationMs
    });
  }

  if (result.outcome === 'UNREACHABLE') {
    payment.status = 'FAILED';
    payment.error = 'BANK_UNAVAILABLE';
    return res.status(503).json({
      error: 'BANK_UNAVAILABLE',
      message: 'Khong ket noi duoc toi ngan hang, chua tru tien',
      paymentId,
      status: 'FAILED',
      remainingDebt: student.debt,
      attempts: payment.attempts,
      durationMs: payment.durationMs
    });
  }

  payment.status = 'PENDING';
  payment.error = 'BANK_TIMEOUT';
  return res.status(504).json({
    error: 'BANK_TIMEOUT',
    message: 'Chua xac dinh duoc ket qua tu ngan hang, lenh dang cho doi soat',
    paymentId,
    status: 'PENDING',
    remainingDebt: student.debt,
    attempts: payment.attempts,
    durationMs: payment.durationMs
  });
});

app.listen(PORT, () => {
  console.log('[fee] chay tai http://localhost:' + PORT);
  console.log('[fee] BANK_URL=' + bankClient.BANK_URL);
  if (NAIVE) {
    console.log('[fee] CHE DO NAIVE: khong timeout, khong thu lai, khong keep-alive, khong idempotency');
  }
});
