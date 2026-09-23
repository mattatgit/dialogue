#!/bin/zsh
cd "$(dirname "$0")"
clear

URL="http://127.0.0.1:4173"

fail() {
  echo "$1"
  echo "$2"
  echo
  read "?Press Return to close."
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  fail "Dialogue needs Node.js 22 or newer before this local build can run." \
       "Install Node once, then double-click this file again."
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null)
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  fail "Dialogue needs Node.js 22 or newer. Your current Node.js version is: $(node --version 2>/dev/null)" \
       "Update Node once, then double-click this file again."
fi

for tool in git ttyd tmux omp; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "Dialogue needs '$tool' on your PATH for the workspace terminal (brew install ttyd tmux; omp from oh-my-pi)." \
         "Install it once, then double-click this file again."
  fi
done

echo "Starting Dialogue…"
echo "Keep this window open while Dialogue is running."
echo

node server.js &
SERVER_PID=$!

sleep 1
open "$URL"

wait $SERVER_PID
