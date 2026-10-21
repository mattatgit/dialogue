# The app and its pinned passkey/email dependencies.
# Runtime tools (git, ttyd, tmux, ssh, and node/npm for project preview
# servers) and omp, the agent, are put on PATH by the wrapper.
{
  lib,
  buildNpmPackage,
  nodejs,
  git,
  ttyd,
  tmux,
  openssh,
  makeWrapper,
  omp,
}:
buildNpmPackage {
  pname = "dialogue";
  version = (lib.importJSON ../package.json).version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../server.js
      ../server
      ../omp
      ../css
      ../js
      ../assets
      ../package.json
      ../package-lock.json
      (lib.fileset.fileFilter (f: f.hasExt "html") ../.)
    ];
  };

  nativeBuildInputs = [ makeWrapper ];
  npmDepsHash = "sha256-MrN6bLnioiIyR5+F6E90ymuswZaHZYhiSlg9+A+ZxHc=";
  dontNpmBuild = true;
  npmFlags = [ "--ignore-scripts" ];

  installPhase = ''
    mkdir -p $out/share/dialogue $out/bin
    cp -r . $out/share/dialogue
    makeWrapper ${lib.getExe nodejs} $out/bin/dialogue-server \
      --add-flags $out/share/dialogue/server.js \
      --prefix PATH : ${lib.makeBinPath ([ nodejs git ttyd tmux openssh omp ])}
  '';

  meta.mainProgram = "dialogue-server";
}
