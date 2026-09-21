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
      description = "Dialogue package providing bin/dialogue-server.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 4173;
      description = "Port the Node server listens on (127.0.0.1 only).";
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/dialogue";
      description = "Directory for db.json and imported prototypes.";
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
      after = [ "network.target" ];
      environment = {
        HOST = "127.0.0.1";
        PORT = toString cfg.port;
        DIALOGUE_DATA = cfg.dataDir;
      };
      serviceConfig = {
        ExecStart = "${cfg.package}/bin/dialogue-server";
        DynamicUser = true;
        StateDirectory = lib.mkIf (cfg.dataDir == "/var/lib/dialogue") "dialogue";
        Restart = "on-failure";
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
        locations."/" = {
          proxyPass = "http://127.0.0.1:${toString cfg.port}";
          # Matches MAX_UPLOAD_BYTES in server.js.
          extraConfig = "client_max_body_size 100m;";
        };
      };
    };
  };
}
