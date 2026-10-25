# Lab 3: Kết nối và duy trì kết nối giữa các service

Hệ thống thanh toán học phí gọi sang cổng ngân hàng (bên thứ ba).

- `bank-service/`: ngân hàng giả lập, cổng **4002**
- `fee-service/`: Fee Service của trường, cổng **4001**
- `scripts/`: script đo đạc cho từng tình huống
- `BAO-CAO.md`: số liệu trước/sau khi sửa của cả 4 tình huống

## Cài đặt

```bash
cd bank-service && npm install
cd ../fee-service && npm install
```

## Chạy

Mở 2 terminal:

```bash
# Terminal 1: ngân hàng
cd bank-service
node server.js

# Terminal 2: Fee Service
cd fee-service
node server.js
```

Hoặc dùng script khởi động nhanh (Git Bash):

```bash
./scripts/restart.sh                 # ngân hàng bình thường
DELAY_MS=5000 ./scripts/restart.sh   # tình huống 2
DROP_RATE=0.3 ./scripts/restart.sh   # tình huống 4a
FAIL_RATE=0.3 ./scripts/restart.sh   # tình huống 4b
NO_BANK=1 ./scripts/restart.sh       # tình huống 1
NAIVE=1 ./scripts/restart.sh         # bản "trước khi sửa" để đối chiếu
```

## API

### Fee Service (4001)

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/students/:id/fees` | Xem công nợ (SV 1: 50.000.000đ, SV 2: 0đ, SV 3: 3.200.000đ) |
| POST | `/students/:id/payments` | Thanh toán, body `{"amount": 100000}` |
| GET | `/payments/:paymentId` | Xem một lệnh thanh toán |

### Ngân hàng giả lập (4002)

| Method | Đường dẫn | Mô tả |
|---|---|---|
| POST | `/charges` | Trừ tiền, body `{"reference","amount"}`, header `Idempotency-Key` |
| GET | `/stats` | `{connections, requests, charges, duplicates}` |

Hạn mức mỗi giao dịch: 20.000.000đ (vượt thì trả 402).

## Biến môi trường

### Ngân hàng

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 4002 | Cổng |
| `DELAY_MS` | 0 | Trễ thêm ngần ấy ms trước khi trừ tiền |
| `FAIL_RATE` | 0 | Tỉ lệ (0–1) trả lỗi 500 trước khi trừ tiền |
| `DROP_RATE` | 0 | Tỉ lệ (0–1) trừ tiền xong rồi cắt kết nối |

Đổi biến thì phải khởi động lại ngân hàng mới áp dụng.

### Fee Service

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 4001 | Cổng |
| `BANK_URL` | `http://localhost:4002` | Địa chỉ ngân hàng |
| `NAIVE` | 0 | `1` để dùng bản gọi ngân hàng ngây thơ (đo "trước khi sửa") |
| `TOTAL_BUDGET_MS` | 4300 | Ngân sách thời gian cho cả lệnh thanh toán |
| `ATTEMPT_TIMEOUT_MS` | 1200 | Hạn chờ mỗi lần thử |
| `CONNECT_TIMEOUT_MS` | 1000 | Hạn chờ bắt tay TCP |
| `MAX_RETRIES` | 3 | Số lần thử tối đa |
| `MAX_SOCKETS` | 10 | Số kết nối song song tối đa tới ngân hàng |

## Quy ước kết quả thanh toán

| Tình trạng | HTTP | `status` | Khi nào |
|---|---|---|---|
| Thành công | 201 | `PAID` | Ngân hàng xác nhận đã trừ tiền |
| Ngân hàng từ chối rõ ràng | giữ mã ngân hàng (402) | `FAILED` | Vượt hạn mức |
| Chắc chắn chưa trừ tiền | 503 | `FAILED` | Không kết nối được tới ngân hàng |
| Không biết đã trừ hay chưa | 504 | `PENDING` | Hết hạn chờ, hoặc đứt kết nối khi đang chờ |

## Chạy các bài đo

```bash
node scripts/burst.js      # tinh huong 2: 20 thanh toan cung luc
node scripts/loadtest.js   # tinh huong 3: 200 thanh toan, 10 dong thoi
node scripts/chaos.js      # tinh huong 4a/4b: 60 thanh toan lan luot
```
