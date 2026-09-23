{
  description = "Dialogue — dev environment, package, NixOS module and demo VM";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # oh-my-pi (omp) for the VM's embedded agent terminal.
    llm-agents.url = "git+https://github.com/numtide/llm-agents.nix?shallow=1";
    llm-agents.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    { nixpkgs, llm-agents, ... }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      linuxSystems = builtins.filter (lib.hasSuffix "-linux") systems;
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system} system);
      vm =
        system:
        (lib.nixosSystem {
          inherit system;
          modules = [
            ./nix/vm.nix
            { services.dialogue.package = nixpkgs.legacyPackages.${system}.callPackage ./nix/package.nix { omp = llm-agents.packages.${system}.omp; }; }
          ];
        }).config.system.build.vm;
      # `nix run .#vm`: stage ./.env (if present) plus OPENROUTER_API_KEY from
      # the current environment into a private directory the VM mounts at
      # /run/dialogue-env, then boot.
      runVm =
        system:
        nixpkgs.legacyPackages.${system}.writeShellApplication {
          name = "run-dialogue-vm";
          text = ''
            DIALOGUE_VM_ENV_DIR="$(mktemp -d)"
            export DIALOGUE_VM_ENV_DIR
            trap 'rm -rf "$DIALOGUE_VM_ENV_DIR"' EXIT
            {
              [ -f .env ] && cat .env
              [ -n "''${OPENROUTER_API_KEY:-}" ] && printf 'OPENROUTER_API_KEY=%s\n' "$OPENROUTER_API_KEY"
              true
            } > "$DIALOGUE_VM_ENV_DIR/env"
            exec ${vm system}/bin/run-nixos-vm "$@"
          '';
        };
    in
    {
      packages = forAllSystems (pkgs: system: {
        default = pkgs.callPackage ./nix/package.nix { };
        with-omp = pkgs.callPackage ./nix/package.nix { omp = llm-agents.packages.${system}.omp; };
      } // lib.optionalAttrs (lib.hasSuffix "-linux" system) { vm = vm system; run-vm = runVm system; });
      devShells = forAllSystems (pkgs: _: { default = import ./nix/devshell.nix { inherit pkgs; }; });
      nixosModules.default = ./nix/module.nix;
      apps = lib.genAttrs linuxSystems (system: {
        vm = {
          type = "app";
          program = lib.getExe (runVm system);
        };
      });
    };
}
