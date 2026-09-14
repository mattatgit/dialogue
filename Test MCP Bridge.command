#!/bin/zsh
cd "$(dirname "$0")"
clear

URL="http://127.0.0.1:4173"

echo "Dialogue MCP bridge test"
echo ""
echo "Keep Start Dialogue.command running in its other window."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not available."
  read "?Press Return to close."
  exit 1
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null)
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  echo "Dialogue needs Node.js 22 or newer."
  read "?Press Return to close."
  exit 1
fi

if [[ ! -d "node_modules/@modelcontextprotocol/server" || ! -d "node_modules/@modelcontextprotocol/client" || ! -d "node_modules/zod" ]]; then
  echo "Installing the local MCP development packages (first run only)…"
  echo ""
  npm install --no-audit --no-fund --package-lock=false
  if [[ $? -ne 0 ]]; then
    echo ""
    echo "Could not install the MCP development packages."
    read "?Press Return to close."
    exit 1
  fi
  echo ""
fi

node -e "fetch('$URL/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
if [[ $? -ne 0 ]]; then
  echo "Dialogue is not running at $URL."
  echo "Double-click Start Dialogue.command first, then run this test again."
  echo ""
  read "?Press Return to close."
  exit 1
fi

node scripts/test-mcp.mjs
STATUS=$?

echo ""
if [[ $STATUS -eq 0 ]]; then
  echo "Opening Landline so you can verify the new MCP-created revision."
  open "$URL/project-landline.html"
else
  echo "The MCP bridge test did not complete."
fi

echo ""
read "?Press Return to close this test window."
exit $STATUS
