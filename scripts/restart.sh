#!/usr/bin/env bash
# Khoi dong lai ca hai service. Vi du:
#   ./scripts/restart.sh                 -> ngan hang binh thuong
#   DELAY_MS=5000 ./scripts/restart.sh   -> tinh huong 2
#   DROP_RATE=0.3 ./scripts/restart.sh   -> tinh huong 4a
#   FAIL_RATE=0.3 ./scripts/restart.sh   -> tinh huong 4b
#   NO_BANK=1 ./scripts/restart.sh       -> tinh huong 1 (khong chay ngan hang)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1
sleep 1

if [ -z "$NO_BANK" ]; then
  ( cd "$ROOT/bank-service" && \
    DELAY_MS="${DELAY_MS:-0}" FAIL_RATE="${FAIL_RATE:-0}" DROP_RATE="${DROP_RATE:-0}" \
    node server.js > "$ROOT/bank.log" 2>&1 & )
  echo "bank-service: DELAY_MS=${DELAY_MS:-0} FAIL_RATE=${FAIL_RATE:-0} DROP_RATE=${DROP_RATE:-0}"
fi

( cd "$ROOT/fee-service" && BANK_URL="${BANK_URL:-http://localhost:4002}" NAIVE="${NAIVE:-0}" node server.js > "$ROOT/fee.log" 2>&1 & )
echo "fee-service: BANK_URL=${BANK_URL:-http://localhost:4002}"
sleep 2
