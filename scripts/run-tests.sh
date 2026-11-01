#!/bin/bash
# 전체 하네스 테스트 실행: 전용 PhotoCraft 인스턴스를 띄우고 scripts/tests/*.ts 를 순서대로 실행한다.
# 사용: scripts/run-tests.sh [포트=7990] [테스트이름 ...]
PORT=${1:-7990}; shift
ROOT=/tmp/jp_test_$PORT
rm -rf "$ROOT"; mkdir -p "$ROOT/cfg"
PHOTOCRAFT_CONFIG_DIR=$ROOT/cfg /Applications/PhotoCraft.app/Contents/MacOS/PhotoCraft \
  --control $PORT --control-token-file $ROOT/token \
  --automation-read-root $ROOT --automation-write-root $ROOT >"$ROOT/pc.log" 2>&1 &
PC_PID=$!
trap 'kill $PC_PID 2>/dev/null' EXIT
for i in $(seq 1 60); do [ -f "$ROOT/token" ] && nc -z 127.0.0.1 $PORT 2>/dev/null && break; sleep 0.5; done
cd "$(dirname "$0")/.."
TESTS=("$@")
[ ${#TESTS[@]} -eq 0 ] && TESTS=($(ls scripts/tests/*.ts | xargs -n1 basename | sed 's/\.ts$//' | grep -v '^_'))
PASS=0; FAIL=0; FAILED=()
for t in "${TESTS[@]}"; do
  if PCPORT=$PORT PCTOKEN=$ROOT/token PCROOT=$ROOT npx tsx scripts/harness.ts scripts/tests/$t.ts >"$ROOT/$t.log" 2>&1; then
    echo "PASS $t"; PASS=$((PASS+1))
  else
    echo "FAIL $t (log: $ROOT/$t.log)"; FAIL=$((FAIL+1)); FAILED+=("$t")
  fi
done
echo "== $PASS passed, $FAIL failed ${FAILED[*]}"
[ $FAIL -eq 0 ]
