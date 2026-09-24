# NixOS module: run the Dialogue server as a systemd service, optionally
# fronted by nginx. No authentication yet.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.dialogue;
in
{
  options.services.dialogue = {
    enable = lib.mkEnableOption "the Dialogue local functional build";

    package = lib.mkOption {
      type = lib.types.package;
      description = "Dialogue package providing bin/dialogue-server (built with the omp package on PATH).";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 4173;
      description = "Port the Node server listens on (127.0.0.1 only).";
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/dialogue";
      description = "Directory for db.json, git mirrors, worktrees and the omp home (dataDir/home).";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "systemd EnvironmentFile (missing file tolerated) with secrets such as OPENROUTER_API_KEY for the embedded omp.";
    };

    seedProjects = lib.mkOption {
      type = lib.types.listOf (lib.types.submodule {
        options = {
          url = lib.mkOption {
            type = lib.types.str;
            description = "Git repository URL (HTTPS, git@host:owner/repo or ssh://).";
          };
        };
      });
      default = [ ];
      description = "Projects added on startup when not present yet (DIALOGUE_SEED). Users can add more from the UI.";
    };

    previewDomain = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "preview.dialogue.example.com";
      description = ''
        Parent domain for per-workspace preview origins (<token>.<previewDomain>),
        which needs wildcard DNS (and a wildcard certificate for HTTPS). When
        null, previews use <token>.preview.localhost on the port the browser
        used, which only works when the browser runs on the same machine (or
        reaches it through a forwarded localhost port, as with the demo VM).
      '';
    };

    nginx = {
      enable = lib.mkEnableOption "an nginx virtual host proxying to Dialogue";

      hostName = lib.mkOption {
        type = lib.types.str;
        default = "localhost";
        description = "nginx virtual host name.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.dialogue = {
      description = "Dialogue server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      environment = {
        HOST = "127.0.0.1";
        PORT = toString cfg.port;
        DIALOGUE_DATA = cfg.dataDir;
        # omp keeps its profile, sessions and credentials here; run /login in
        # the web terminal on first use.
        HOME = "${cfg.dataDir}/home";
        DIALOGUE_SEED = toString (pkgs.writeText "dialogue-seed.json" (builtins.toJSON cfg.seedProjects));
        # Prototype preview screenshots for project cards and branch tiles.
        DIALOGUE_CHROMIUM = lib.getExe pkgs.chromium;
      }
      // lib.optionalAttrs (cfg.previewDomain != null) {
        DIALOGUE_PREVIEW_DOMAIN = cfg.previewDomain;
      };
      preStart = "mkdir -p ${cfg.dataDir}/home";
      serviceConfig = {
        ExecStart = "${cfg.package}/bin/dialogue-server";
        # Optional secrets (e.g. OPENROUTER_API_KEY) for the embedded omp.
        EnvironmentFile = lib.mkIf (cfg.environmentFile != null) "-${cfg.environmentFile}";
        DynamicUser = true;
        StateDirectory = lib.mkIf (cfg.dataDir == "/var/lib/dialogue") "dialogue";
        Restart = "on-failure";
        KillMode = "mixed";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.dataDir ];
      };
    };

    services.nginx = lib.mkIf cfg.nginx.enable {
      enable = true;
      virtualHosts.${cfg.nginx.hostName} = {
        # Preview origins arrive under other host names; route them here too.
        serverAliases = [ "*.preview.localhost" ] ++ lib.optional (cfg.previewDomain != null) "*.${cfg.previewDomain}";
        locations."/" = {
          proxyPass = "http://127.0.0.1:${toString cfg.port}";
          proxyWebsockets = true;
          # Long-lived SSE and terminal WebSocket connections. Dialogue picks
          # the preview to serve from the Host header, so pass the browser's.
          extraConfig = ''
            proxy_set_header Host $http_host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_buffering off;
            proxy_read_timeout 1h;
            proxy_send_timeout 1h;
          '';
        };
      };
    };
  };
}
