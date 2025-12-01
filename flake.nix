{
  description = "A Nix-flake-based Bun development environment";

  inputs = {
    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1"; # unstable Nixpkgs
    treefmt-nix.url = "github:numtide/treefmt-nix";
    git-hooks-nix.url = "github:cachix/git-hooks.nix";
  };

  outputs =
    { self, ... }@inputs:

    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forEachSupportedSystem =
        f:
        inputs.nixpkgs.lib.genAttrs supportedSystems (
          system:
          f rec {
            inherit system;
            pkgs = import inputs.nixpkgs { inherit system; };
            treefmt =
              (inputs.treefmt-nix.lib.evalModule pkgs {
                projectRootFile = "flake.nix";
                programs.nixfmt.enable = true;
                programs.biome.enable = true;
              }).config.build.wrapper;
            pre-commit-check = inputs.git-hooks-nix.lib.${system}.run {
              src = ./.;
              hooks = {
                treefmt = {
                  enable = true;
                  package = treefmt;
                };
              };
            };
          }
        );
    in
    {
      formatter = forEachSupportedSystem ({ treefmt, ... }: treefmt);

      checks = forEachSupportedSystem (
        { pkgs, pre-commit-check, ... }:
        {
          pre-commit = pre-commit-check;
        }
      );

      devShells = forEachSupportedSystem (
        { pkgs, pre-commit-check, ... }:
        {
          default = pkgs.mkShellNoCC {
            packages = with pkgs; [ bun ];
            shellHook = pre-commit-check.shellHook;
          };
        }
      );
    };
}
