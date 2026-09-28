{
  description = "Dialogue — dev environment, package, NixOS module and demo VM";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # oh-my-pi (omp): the agent every workspace, preview setup and COMMIT runs.
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
        # No x86_64-darwin: llm-agents has no omp for it.
        "aarch64-darwin"
      ];
      linuxSystems = builtins.filter (lib.hasSuffix "-linux") systems;
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system} system);
      # omp's `--smoke-test` install check fails inside the macOS Nix build
      # sandbox ("Port 0 is in use, but the listening process could not be
      # identified"); the same binary passes it outside the sandbox. Drop just
      # that line there, and fail loudly if upstream changes it.
      omp =
        system:
        let
          pkg = llm-agents.packages.${system}.omp;
          smokeTest = ''HOME=$TMPDIR $out/bin/omp --smoke-test | grep -q "smoke-test: ok"'';
        in
        if !lib.hasSuffix "-darwin" system then
          pkg
        else
          pkg.overrideAttrs (old: {
            installCheckPhase =
              assert lib.assertMsg (lib.hasInfix smokeTest old.installCheckPhase) "omp's installCheckPhase changed; revisit the darwin smoke-test patch in flake.nix";
              lib.replaceStrings [ smokeTest ] [ "" ] old.installCheckPhase;
          });
      package = system: nixpkgs.legacyPackages.${system}.callPackage ./nix/package.nix { omp = omp system; };
      vm =
        system:
        (lib.nixosSystem {
          inherit system;
          modules = [
            ./nix/vm.nix
            { services.dialogue.package = package system; }
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
        default = package system;
      } // lib.optionalAttrs (lib.hasSuffix "-linux" system) { vm = vm system; run-vm = runVm system; });
      devShells = forAllSystems (pkgs: system: { default = import ./nix/devshell.nix { inherit pkgs; omp = omp system; }; });
      nixosModules.default = ./nix/module.nix;
      apps = lib.genAttrs linuxSystems (system: {
        vm = {
          type = "app";
          program = lib.getExe (runVm system);
        };
      });
    };
}
