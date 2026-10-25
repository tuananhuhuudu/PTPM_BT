# Báo cáo Lab 3: Kết nối và duy trì kết nối giữa các service

Môi trường đo: Windows 11, Node.js v24.15.0, Fee Service cổng 4001, ngân hàng giả lập cổng 4002, chạy cùng một máy.

Số liệu "trước khi sửa" em lấy bằng cách chạy Fee Service với `NAIVE=1`, là bản gọi ngân hàng ngây thơ
(không đặt hạn chờ, không thử lại, không keep-alive, không idempotency) ở `fee-service/bankClientNaive.js`.
Bản đã sửa ở `fee-service/bankClient.js`.

## Tổng hợp

| TH | Chỉ tiêu | Trước khi sửa | Sau khi sửa | Đạt |
|---|---|---|---|---|
| 1 | Ngân hàng tắt → 503 trong < 1,5s | 503 / 0,11s | 503 / 0,51s | Đạt |
| 1 | `GET /fees` vẫn 200 khi ngân hàng chết | 200 / 38ms | 200 / 38ms | Đạt |
| 1 | Ngân hàng chạy lại → 201, không restart Fee Service | 201 | 201 | Đạt |
| 2 | Trả 504 + `PENDING` | 201 sau 5,1s | 504 `PENDING` | Đạt |
| 2 | Tổng thời gian ≤ 4,5s | **5175 ms** | **4143 ms** | Đạt |
| 2 | `GET /fees` < 300ms khi 20 lệnh đang chờ | 17 ms | 7 ms | Đạt |
| 3 | 200/200 thanh toán thành công | 200/200 | 200/200 | Đạt |
| 3 | Số kết nối TCP ≤ 20 | **206** | **16** | Đạt |
| 3 | Sau nhàn rỗi 6s vẫn thành công | 5/5 | 5/5 | Đạt |
| 4a | `duplicates = 0`, ≥ 54/60 thành công | **41/60** | **60/60** | Đạt |
| 4b | ≥ 54/60 thành công, không trừ tiền 2 lần | **38/60** | **57/60** | Đạt |
| 4c | Trả 402, ngân hàng chỉ nhận 1 yêu cầu | 402 / 1 yêu cầu | 402 / 1 yêu cầu | Đạt |

---

## Tình huống 1: Ngân hàng không kết nối được, rồi hoạt động lại

**Cách đo:** chỉ chạy Fee Service, không chạy ngân hàng, gọi `POST /students/1/payments {"amount":100000}`.

| Phép đo | Kết quả |
|---|---|
| Mã trả về khi ngân hàng tắt | **503** trong **508 ms** |
| Thân phản hồi | `{"error":"BANK_UNAVAILABLE","paymentId":"P1","status":"FAILED"}` |
| `GET /students/1/fees` lúc đó | **200** trong **38 ms**, `debt` vẫn 50.000.000 |
| Sau khi bật ngân hàng (không restart Fee Service) | **201**, `chargeId: CH1` |

Đổi `BANK_URL=http://localhost:4999` cho kết quả giống hệt.

**Em đã sửa:** đặt hạn chờ kết nối riêng `CONNECT_TIMEOUT_MS = 1000`, nếu socket chưa `connect` trong 1 giây
thì bỏ luôn, không để hệ điều hành chờ hết `ETIMEDOUT` mặc định (hàng chục giây). Lỗi `ECONNREFUSED` nghĩa là
chắc chắn chưa trừ tiền nên trả **503/FAILED** chứ không phải 504/PENDING. Lỗi mạng được bọc trong `try/catch`
nên không làm sập Fee Service, và `GET /fees` chỉ đọc bộ nhớ nên ngân hàng chết vẫn xem công nợ được.
Địa chỉ ngân hàng đọc từ `BANK_URL` mỗi lần gọi nên khi ngân hàng sống lại thì tự nối được.

---

## Tình huống 2: Ngân hàng phản hồi rất chậm

**Cách đo:** chạy ngân hàng `DELAY_MS=5000`, bắn 20 thanh toán cùng lúc bằng `node scripts/burst.js`,
trong lúc đó gọi `GET /students/1/fees` 5 lần.

| Phép đo | Trước khi sửa | Sau khi sửa |
|---|---|---|
| Mã trả về | 201 (chờ cho bằng xong) | **504** |
| `status` | `PAID` | **`PENDING`** |
| Tổng thời gian 20 lệnh | **5175 ms** | **4143 ms** |
| `GET /fees` chậm nhất | 17 ms | **7 ms** |

**Em đã sửa:** đặt ngân sách thời gian hai tầng: `ATTEMPT_TIMEOUT_MS = 1200` cho mỗi lần thử và
`TOTAL_BUDGET_MS = 4300` cho cả lệnh. Trước mỗi lần thử em tính thời gian còn lại, còn dưới 50ms thì dừng,
nhờ đó không bao giờ vượt 4,5 giây. Hết ngân sách mà chưa có trả lời thì không biết ngân hàng đã trừ tiền
hay chưa nên trả **504 + `PENDING`** để lệnh lại chờ đối soát.

`GET /fees` vẫn nhanh vì Node.js xử lý bất đồng bộ, 20 lệnh đang chờ chỉ là 20 promise treo, không chiếm
event loop.

---

## Tình huống 3: Duy trì kết nối

**Cách đo:** `node scripts/loadtest.js` gửi 200 thanh toán, 10 yêu cầu cùng lúc, 1.000đ mỗi lần.
Sau đó nghỉ 6 giây rồi gửi thêm 5 thanh toán.

| Phép đo | Trước khi sửa | Sau khi sửa |
|---|---|---|
| Thanh toán thành công | 200/200 | 200/200 |
| Tổng thời gian | 460 ms | **216 ms** |
| **Số kết nối TCP ngân hàng phải mở** | **206** | **16** |
| Thành công sau khi nhàn rỗi 6 giây | 5/5 | 5/5 |

Giảm được **206 → 16 kết nối**, nhanh hơn 2 lần.

**Em đã sửa:** bản cũ đặt `agent: false` và gửi `Connection: close` nên mỗi lời gọi mở một kết nối TCP mới
rồi đóng ngay (200 thanh toán → 200 kết nối). Em thay bằng một `http.Agent` dùng chung với `keepAlive: true`,
`maxSockets: 10` (khớp với 10 yêu cầu đồng thời, yêu cầu thứ 11 xếp hàng chờ chứ không mở thêm kết nối) và
`maxFreeSockets: 10` để giữ lại socket rảnh dùng cho lần sau.

Ngân hàng đóng kết nối nhàn rỗi sau 5 giây, nên sau 6 giây nghỉ thì hồ socket còn giữ socket đã bị phía kia
đóng, gửi vào sẽ nhận `ECONNRESET`. Em phân biệt bằng cờ `req.reusedSocket`:

```js
if ((code === 'ECONNRESET' || code === 'EPIPE') && req.reusedSocket) {
  return reject(new BankError('STALE_SOCKET', 'Ket noi nhan roi da bi dong'));
}
```

Lỗi này chắc chắn chưa tới tay ngân hàng nên thử lại ngay được, và em không tính nó vào số lần thử
(`attempt--`). Nhờ vậy 5/5 thanh toán sau khi nhàn rỗi vẫn thành công.

---

## Tình huống 4: Đứt giữa chừng, lỗi tạm thời, bị từ chối

### 4a. Trừ tiền rồi đứt kết nối (`DROP_RATE=0.3`, 60 thanh toán)

| Phép đo | Trước khi sửa | Sau khi sửa |
|---|---|---|
| PAID | **41/60** | **60/60** |
| PENDING | 19 | 0 |
| `charges` ở ngân hàng | **60** | 60 |
| `duplicates` | 0 | **0** |
| Công nợ giảm / đúng ra phải giảm | 41.000 / 41.000 | **60.000 / 60.000** |

Chỗ này lộ rõ cái sai của bản cũ: ngân hàng đã trừ **60 lần** nhưng Fee Service chỉ ghi nhận **41 lệnh PAID**,
tức là **19 lần sinh viên bị trừ tiền mà công nợ không giảm**.

### 4b. Lỗi 500 tạm thời (`FAIL_RATE=0.3`, 60 thanh toán)

| Phép đo | Trước khi sửa | Sau khi sửa |
|---|---|---|
| PAID | **38/60** | **57/60** |
| `charges` ở ngân hàng | 38 | **57** (bằng đúng số PAID) |
| `duplicates` | 0 | **0** |
| Lệnh lâu nhất | 35 ms | **478 ms** (≤ 4500 ms) |

Tình huống này có yếu tố ngẫu nhiên nên số PAID dao động 57 đến 60 giữa các lần chạy, nhưng luôn vượt mốc 54
và `charges` luôn bằng đúng số lệnh PAID.

### 4c. Vượt hạn mức (thanh toán 25.000.000đ)

| Phép đo | Kết quả |
|---|---|
| Mã trả về | **402** (giữ nguyên mã ngân hàng), `status: FAILED` |
| Số yêu cầu ngân hàng nhận | **đúng 1** (không thử lại) |
| Công nợ | không đổi |

**Em đã sửa:** ba kiểu hỏng này cần ba cách xử lý khác hẳn nhau.

**(a) Trừ tiền rồi đứt kết nối** là khó nhất vì không biết ngân hàng đã trừ hay chưa. Thử lại thì sợ trừ hai
lần, không thử lại thì mất giao dịch như bản cũ. Em dùng **khóa idempotency**: mỗi lệnh gửi
`Idempotency-Key: <paymentId>`, ngân hàng lưu kết quả theo khóa đó, gửi lại cùng khóa thì trả giao dịch cũ
chứ không trừ thêm:

```js
if (key && byKey.has(key)) {
  return res.status(200).json(byKey.get(key));
}
```

Nhờ đó thử lại trở nên an toàn, đạt 60/60 mà `duplicates` vẫn bằng 0.

**(b) Lỗi 500** là lỗi tạm thời, chắc chắn chưa trừ tiền nên cứ thử lại, tối đa 3 lần, giữa các lần nghỉ
theo backoff lũy thừa cộng nhiễu ngẫu nhiên: `Math.min(120 * 2^(n-1), 500) + random(0..60)`, nghỉ
120ms → 240ms → 480ms. Phần ngẫu nhiên tránh nhiều lệnh cùng thử lại một lúc rồi lại cùng đập vào ngân hàng
đang yếu. Với tỉ lệ lỗi 0,3 thì xác suất hỏng cả 3 lần chỉ còn 0,3³ ≈ 2,7%.

**(c) Vượt hạn mức** là từ chối dứt khoát, thử lại bao nhiêu lần cũng bị từ chối nên em trả về ngay khi gặp
mã 4xx. Phía ngân hàng em cũng đặt việc kiểm tra hạn mức **trước** `DELAY_MS` và `FAIL_RATE`, vì một yêu cầu
chắc chắn bị từ chối thì nên từ chối luôn, không cần bắt chờ.

**Về quy tắc "công nợ chỉ giảm khi ngân hàng đã trừ tiền":** em chỉ trừ `student.debt` sau khi nhận xác nhận
`CHARGED`. Nhưng khi nhiều lệnh chạy song song, nếu chỉ nhìn `debt` thì 20 lệnh cùng lúc đều thấy còn đủ nợ
và đều được nhận, có thể trả vượt công nợ. Nên em thêm trường `holding` là tiền của các lệnh đang chờ:

```js
if (amount > student.debt - student.holding) { ... 400 ... }
student.holding += amount;
try { result = await bankClient.charge(...); } finally { student.holding -= amount; }
```

Kiểm tra theo `debt - holding` nên không nhận quá số nợ thật, còn `GET /fees` vẫn trả đúng `debt` chưa trừ
cho tới khi tiền thực sự bị trừ.

---

## Quy ước kết quả thanh toán

| Tình trạng | HTTP | `status` | Khi nào |
|---|---|---|---|
| Thành công | 201 | `PAID` | Ngân hàng xác nhận đã trừ tiền |
| Ngân hàng từ chối rõ ràng | giữ mã ngân hàng (402) | `FAILED` | Vượt hạn mức |
| Chắc chắn chưa trừ tiền | 503 | `FAILED` | Không kết nối được tới ngân hàng |
| Không biết đã trừ hay chưa | 504 | `PENDING` | Hết hạn chờ, hoặc đứt kết nối khi đang chờ |

---

## Kết luận

Bốn tình huống đều đạt hết chỉ tiêu. Những điều em rút ra:

1. **Luôn phải đặt hạn chờ.** Không có hạn chờ thì một dịch vụ chậm kéo cả hệ thống chậm theo.
2. **Dùng lại kết nối.** Chỉ thêm `keepAlive` mà giảm được 206 xuống 16 kết nối TCP và nhanh hơn 2 lần.
3. **Thử lại phải đi kèm idempotency.** Thử lại không có khóa thì trừ tiền hai lần, không thử lại thì mất
   giao dịch (41/60). Có khóa rồi thì vừa đạt 60/60 vừa giữ `duplicates = 0`.
4. **Phải phân biệt rõ ba loại lỗi:** "chưa trừ tiền" (503) thì thử lại được, "bị từ chối" (402) thì đừng
   thử lại, "không rõ" (504 `PENDING`) thì để lại đối soát chứ không được đoán bừa.
