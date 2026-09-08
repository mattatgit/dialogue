#!/bin/zsh
cd "$(dirname "$0")"
clear
if ! command -v node >/dev/null 2>&1; then
  echo "Dialogue needs Node.js 22 or newer before this local build can run."
  echo "Ask your developer to install Node once, then double-click this file again."
  echo
  read "?Press Return to close."
  exit 1
fi
node server.js
