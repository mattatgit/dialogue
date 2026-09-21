# Headless QEMU VM hosting Dialogue behind nginx. Guest :80 is forwarded to
# host 127.0.0.1:8483.
{ modulesPath, pkgs, ... }:
{
  imports = [
    "${modulesPath}/virtualisation/qemu-vm.nix"
    ./module.nix
  ];

  services.dialogue = {
    enable = true;
    package = pkgs.callPackage ./package.nix { };
    nginx.enable = true;
  };

  networking.firewall.allowedTCPPorts = [ 80 ];

  virtualisation = {
    graphics = false;
    forwardPorts = [
      {
        from = "host";
        host.port = 8483;
        guest.port = 80;
      }
    ];
  };

  services.getty.autologinUser = "root";
  system.stateVersion = "25.11";
}
