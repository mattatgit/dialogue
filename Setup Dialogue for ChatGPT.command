#!/bin/zsh

set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT="$(cd "$(dirname "$0")" && pwd)"
PROFILE_NAME="dialogue"
PROFILE_PATH="$HOME/.config/tunnel-client/${PROFILE_NAME}.yaml"
KEYCHAIN_SERVICE="Dialogue ChatGPT Tunnel Runtime Key"
KEYCHAIN_ACCOUNT="${USER:-$(id -un)}"
TUNNELS_URL="https://platform.openai.com/settings/organization/tunnels"
RUNTIME_KEYS_URL="https://platform.openai.com/settings/organization/api-keys"

pause_before_close() {
  echo
  read "?Press Return to close."
}

fail() {
  echo
  echo "Setup could not continue: $1"
  pause_before_close
  exit 1
}

clear
echo "Dialogue + ChatGPT setup"
echo "========================"
echo
echo "This one-time setup connects this Mac's local Dialogue app to ChatGPT."
echo "Your Runtime API key will be stored in macOS Keychain, not in the Dialogue repo or tunnel profile."
echo

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "this setup is currently for macOS only."
fi

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js 22 or newer is not available. Install or update Node, then run this setup again."
fi

NODE_PATH="$(command -v node)"
NODE_MAJOR="$($NODE_PATH -p "Number(process.versions.node.split('.')[0])" 2>/dev/null)"
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  fail "Dialogue needs Node.js 22 or newer. Current version: $($NODE_PATH --version 2>/dev/null)"
fi

if ! command -v tunnel-client >/dev/null 2>&1; then
  echo "tunnel-client is not installed."
  echo
  echo "Install it with Homebrew:"
  echo "  brew install openai/tools/tunnel-client"
  echo
  echo "Then run this setup again."
  pause_before_close
  exit 1
fi

if [[ ! -f "$ROOT/mcp-server.mjs" ]]; then
  fail "mcp-server.mjs was not found next to this setup file. Run the setup from inside the Dialogue repo."
fi

if ! command -v /usr/bin/security >/dev/null 2>&1; then
  fail "macOS Keychain command-line support is unavailable."
fi

echo "Before continuing, have these two OpenAI values ready:"
echo "  1. Your own Secure MCP Tunnel ID (starts with tunnel_)"
echo "     $TUNNELS_URL"
echo "  2. Your own Runtime API key with Tunnels Read + Use"
echo "     $RUNTIME_KEYS_URL"
echo
read "?Press Return when you have both ready."
echo

while true; do
  read "TUNNEL_ID?Tunnel ID: "
  TUNNEL_ID="${TUNNEL_ID## }"
  TUNNEL_ID="${TUNNEL_ID%% }"
  if [[ "$TUNNEL_ID" == tunnel_* ]]; then
    break
  fi
  echo "That does not look like a tunnel ID. It should start with tunnel_."
done

echo
read -s "RUNTIME_KEY?Runtime API key (input is hidden): "
echo
if [[ -z "$RUNTIME_KEY" ]]; then
  fail "no Runtime API key was entered."
fi

echo
echo "Saving the Runtime API key in macOS Keychain..."
if ! /usr/bin/security add-generic-password \
  -U \
  -a "$KEYCHAIN_ACCOUNT" \
  -s "$KEYCHAIN_SERVICE" \
  -w "$RUNTIME_KEY" >/dev/null 2>&1; then
  unset RUNTIME_KEY
  fail "the Runtime API key could not be saved in macOS Keychain."
fi
unset RUNTIME_KEY

if ! CONTROL_PLANE_API_KEY="$(/usr/bin/security find-generic-password \
  -a "$KEYCHAIN_ACCOUNT" \
  -s "$KEYCHAIN_SERVICE" \
  -w 2>/dev/null)"; then
  fail "the Runtime API key was saved but could not be read back from macOS Keychain."
fi
export CONTROL_PLANE_API_KEY

if [[ -f "$PROFILE_PATH" ]]; then
  BACKUP_PATH="${PROFILE_PATH}.backup.$(date +%Y%m%d-%H%M%S)"
  if ! cp "$PROFILE_PATH" "$BACKUP_PATH"; then
    unset CONTROL_PLANE_API_KEY
    fail "the existing tunnel profile could not be backed up."
  fi
  echo "Backed up the existing profile to:"
  echo "  $BACKUP_PATH"
fi

MCP_COMMAND="\"$NODE_PATH\" \"$ROOT/mcp-server.mjs\""

echo
echo "Creating the Dialogue tunnel profile..."
if ! tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile "$PROFILE_NAME" \
  --tunnel-id "$TUNNEL_ID" \
  --mcp-command "$MCP_COMMAND" \
  --force; then
  unset CONTROL_PLANE_API_KEY
  fail "tunnel-client could not create the Dialogue profile."
fi

echo
echo "Checking the profile..."
if ! tunnel-client doctor --profile "$PROFILE_NAME" --explain; then
  unset CONTROL_PLANE_API_KEY
  fail "tunnel-client doctor found a problem. Review the output above and try the setup again."
fi

unset CONTROL_PLANE_API_KEY
chmod +x "$ROOT/Setup Dialogue for ChatGPT.command" "$ROOT/Start Dialogue with ChatGPT.command" 2>/dev/null || true

echo
echo "Setup complete."
echo "From now on, double-click:"
echo "  Start Dialogue with ChatGPT.command"
echo
echo "The launcher will start Dialogue, start the tunnel, wait until ChatGPT connectivity is ready, and open Dialogue in your browser."
pause_before_close
