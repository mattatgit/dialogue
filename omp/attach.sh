#!/bin/sh
# Run by ttyd for every terminal client: attach to (or create) the tmux
# session running omp in the workspace. The session name carries a checksum
# of the omp overlay files, so editing omp/* and reconnecting starts a fresh
# omp with the new settings while stale sessions for this workspace are
# killed. Sessions otherwise outlive Dialogue restarts on purpose.
#
# Env: DIALOGUE_APP (this repo), DIALOGUE_WORKSPACE_DIR, DIALOGUE_SESSION
# (per-workspace prefix), DIALOGUE_TMUX, DIALOGUE_OMP.
set -eu
app="$DIALOGUE_APP"
tmux="${DIALOGUE_TMUX:-tmux}"
omp="${DIALOGUE_OMP:-omp}"

sum=$(cat "$app/omp/config.yml" "$app/omp/system-prompt.md" "$app/omp/tmux.conf" "$app/omp/dialogue-theme.json" | cksum | cut -d' ' -f1)
session="$DIALOGUE_SESSION-$sum"

"$tmux" -L dialogue list-sessions -F '#S' 2>/dev/null | while IFS= read -r name; do
  case "$name" in
    "$DIALOGUE_SESSION-"*) [ "$name" = "$session" ] || "$tmux" -L dialogue kill-session -t "=$name" || true ;;
  esac
done

exec "$tmux" -L dialogue -f "$app/omp/tmux.conf" \
  new-session -A -s "$session" -c "$DIALOGUE_WORKSPACE_DIR" \
  "$omp" --config "$app/omp/config.yml" --append-system-prompt "$app/omp/system-prompt.md"
