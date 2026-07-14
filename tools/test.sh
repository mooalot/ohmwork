#!/usr/bin/env bash
# Full test suite: schema validation, node unit tests, solver-vs-bank checks,
# and headless-browser DOM/interaction suites. Exits non-zero on any failure.
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0
step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

step "question bank schema (tools/validate.js)"
node tools/validate.js || FAIL=1

step "unit tests (node --test)"
node --test tests/*.test.mjs || FAIL=1

step "solver vs question bank (tools/sim-test.mjs)"
node tools/sim-test.mjs || FAIL=1

step "browser suites (headless Chrome)"
CHROME="${CHROME:-}"
for c in "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
  [ -z "$CHROME" ] && [ -x "$c" ] && CHROME="$c"
done
if [ -z "$CHROME" ]; then
  echo "SKIP: no Chrome found (set CHROME=/path/to/chrome)"
else
  PORT=8973
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  SRV=$!
  trap 'kill $SRV 2>/dev/null' EXIT
  sleep 1
  for page in test-logic test-interactive; do
    TITLE=$("$CHROME" --headless --disable-gpu --virtual-time-budget=9000 \
      --dump-dom "http://127.0.0.1:$PORT/tools/$page.html" 2>/dev/null \
      | grep -oE '<title>[^<]*' | head -1)
    if [ "$TITLE" = "<title>ALLPASS" ]; then
      echo "PASS $page.html"
    else
      echo "FAIL $page.html ($TITLE)"
      FAIL=1
    fi
  done
fi

echo
if [ "$FAIL" = 0 ]; then echo "✅ all suites passed"; else echo "❌ FAILURES"; fi
exit $FAIL
