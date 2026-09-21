{
  description = "Dialogue — dev environment, package, NixOS module and demo VM";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      linuxSystems = builtins.filter (lib.hasSuffix "-linux") systems;
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      vm = system: (lib.nixosSystem { inherit system; modules = [ ./nix/vm.nix ]; }).config.system.build.vm;
    in
    {
      packages = forAllSystems (pkgs: { default = pkgs.callPackage ./nix/package.nix { }; });
      devShells = forAllSystems (pkgs: { default = import ./nix/devshell.nix { inherit pkgs; }; });
      nixosModules.default = ./nix/module.nix;
      apps = lib.genAttrs linuxSystems (system: {
        vm = {
          type = "app";
          program = "${vm system}/bin/run-nixos-vm";
        };
      });
    };
}
