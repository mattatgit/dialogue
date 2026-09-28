{ pkgs, omp }:
let
  # Headless Chromium for preview screenshots. nixpkgs' chromium is Linux-only,
  # and on macOS full Chrome/Brave crash headless without a desktop session;
  # Playwright's chrome-headless-shell (Chromium, BSD) works everywhere.
  headlessShell =
    let
      browsers = pkgs.playwright-driver.browsers.override {
        withChromium = false;
        withFirefox = false;
        withWebkit = false;
        withFfmpeg = false;
      };
    in
    pkgs.runCommand "chrome-headless-shell" { } ''
      bin=$(echo ${browsers}/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell)
      [ -x "$bin" ] || { echo "chrome-headless-shell not found in ${browsers}" >&2; exit 1; }
      mkdir -p $out/bin
      # A wrapper, not a symlink: Chrome finds its framework next to argv[0].
      printf '#!/bin/sh\nexec %s "$@"\n' "$bin" > $out/bin/chrome-headless-shell
      chmod +x $out/bin/chrome-headless-shell
    '';
  tools = [
    pkgs.nodejs
    pkgs.browser-sync
    pkgs.git
    pkgs.ttyd
    pkgs.tmux
    pkgs.openssh
    omp
  ] ++ (if pkgs.stdenv.hostPlatform.isLinux then [ pkgs.chromium ] else [ headlessShell ]);
  dev = pkgs.writeShellApplication {
    name = "dev";
    runtimeInputs = tools;
    text = ''
      # Run the Dialogue Node server with live reload in the browser.
      #
      #   node --watch server.js   restarts the API/app server on server.js edits
      #   browser-sync             proxies it on PORT (default 8080) and reloads
      #                            open tabs when html/css/js/assets change
      #
      # PORT overrides the public port; OPEN=0 skips launching the browser.
      # omp comes from the devshell (DIALOGUE_OMP overrides). DIALOGUE_SEED
      # defaults to the repo's seed.json (Landline) so a fresh data dir has
      # a project to open.
      port="''${PORT:-8080}"
      upstream=4173
      export DIALOGUE_SEED="''${DIALOGUE_SEED:-seed.json}"
      # Preview origins (<token>.preview.localhost) go straight to the Node
      # server: browser-sync would rewrite the Host header they are routed by.
      export DIALOGUE_PREVIEW_PORT="$upstream"
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
  packages = [ dev ] ++ tools;
}
