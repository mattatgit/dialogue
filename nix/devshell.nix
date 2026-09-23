{ pkgs }:
let
  dev = pkgs.writeShellApplication {
    name = "dev";
    runtimeInputs = [
      pkgs.nodejs
      pkgs.browser-sync
      pkgs.git
      pkgs.ttyd
      pkgs.tmux
    ];
    text = ''
      # Run the Dialogue Node server with live reload in the browser.
      #
      #   node --watch server.js   restarts the API/app server on server.js edits
      #   browser-sync             proxies it on PORT (default 8080) and reloads
      #                            open tabs when html/css/js/assets change
      #
      # PORT overrides the public port; OPEN=0 skips launching the browser.
      # omp is taken from your own PATH (or DIALOGUE_OMP).
      port="''${PORT:-8080}"
      upstream=4173
      PORT="$upstream" node --watch server.js &
      server=$!
      trap 'kill "$server" 2>/dev/null' EXIT

      open=local
      [ "''${OPEN:-1}" = 0 ] && open=false

      exec browser-sync start \
        --proxy "127.0.0.1:$upstream" \
        --listen 127.0.0.1 \
        --port "$port" \
        --ws \
        --files '*.html' 'css/**' 'js/**' 'assets/**' 'server.js' 'server/**' \
        --reload-delay 600 \
        --no-ui --no-notify --no-ghost-mode \
        --open "$open" \
        "$@"
    '';
  };
in
pkgs.mkShell {
  packages = [
    dev
    pkgs.nodejs
    pkgs.browser-sync
    pkgs.git
    pkgs.ttyd
    pkgs.tmux
  ];
}
