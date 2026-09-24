# Headless QEMU VM hosting Dialogue behind nginx. Guest :80 is forwarded to
# host 127.0.0.1:8483, guest :22 to host 127.0.0.1:2222 (ssh root@localhost
# -p 2222, empty password — demo VM only). services.dialogue.package is
# supplied by flake.nix so omp from the llm-agents input is on the PATH.
{ modulesPath, pkgs, ... }:
let
  hostPort = 8483;
  sshPort = 2222;
in
{
  imports = [
    "${modulesPath}/virtualisation/qemu-vm.nix"
    ./module.nix
  ];

  services.dialogue = {
    enable = true;
    nginx.enable = true;
    # Provided by the host: `nix run .#vm` stages the project's .env into the
    # directory named by $DIALOGUE_VM_ENV_DIR, shared below via 9p.
    environmentFile = "/run/dialogue-env/env";
    seedProjects = [ { url = "https://github.com/mattatgit/landline"; prototypePath = "prototypes/app"; } ];
  };
  # omp's browser tool needs a Chromium it can run on NixOS; a downloaded
  # Chrome would fail to link, so point Puppeteer at the packaged one.
  systemd.services.dialogue.environment.PUPPETEER_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
  systemd.services.dialogue.after = [ "run-dialogue\\x2denv.mount" ];
  systemd.services.dialogue.wants = [ "run-dialogue\\x2denv.mount" ];

  networking.firewall.allowedTCPPorts = [ 80 22 ];

  virtualisation = {
    graphics = false;
    # omp (Bun) plus a headless Chromium for its browser tool need real
    # memory; the qemu-vm default of 1 GiB gets omp OOM-killed.
    memorySize = 4096;
    cores = 2;
    forwardPorts = [
      { from = "host"; host.port = hostPort; guest.port = 80; }
      { from = "host"; host.port = sshPort; guest.port = 22; }
    ];
    sharedDirectories.dialogue-env = {
      source = "\${DIALOGUE_VM_ENV_DIR:-/var/empty}";
      target = "/run/dialogue-env";
      writable = false;
    };
  };

  services.openssh = {
    enable = true;
    settings = {
      PermitRootLogin = "yes";
      PermitEmptyPasswords = "yes";
    };
  };
  users.users.root.initialHashedPassword = "";
  security.pam.services.sshd.allowNullPassword = true;

  # Debug helpers for the root shell: journal + the workspace tmux sessions
  # run under the dialogue DynamicUser.
  environment.systemPackages = [ pkgs.tmux ];

  # The login prompt waits for Dialogue to answer, then shows the host URL as
  # the login banner so it is the last thing on the console after boot.
  systemd.services.dialogue-ready = {
    description = "Wait for Dialogue to answer on nginx";
    wantedBy = [ "multi-user.target" ];
    after = [ "dialogue.service" "nginx.service" ];
    path = [ pkgs.curl ];
    serviceConfig.Type = "oneshot";
    script = ''
      for _ in $(seq 1 60); do
        curl -sf -m 2 http://127.0.0.1/api/health >/dev/null && exit 0
        sleep 1
      done
      echo "Dialogue did not answer within 60s" >&2
    '';
  };
  systemd.services."serial-getty@ttyS0".after = [ "dialogue-ready.service" ];
  systemd.services."getty@tty1".after = [ "dialogue-ready.service" ];

  environment.etc.issue.text = ''

    Dialogue is ready: open  http://127.0.0.1:${toString hostPort}  on your host
    Debug shell:             ssh -p ${toString sshPort} root@127.0.0.1   (no password)

  '';
  services.getty.autologinUser = "root";
  system.stateVersion = "25.11";
}
