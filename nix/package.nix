# The app: static UI files plus server.js (Node builtins only, no npm deps).
# Runtime tools (git, ttyd, tmux, ssh, and node/npm for project preview
# servers) are put on PATH by the wrapper; omp is optional here because
# developers normally run their own.
{
  lib,
  stdenvNoCC,
  nodejs,
  git,
  ttyd,
  tmux,
  openssh,
  makeWrapper,
  omp ? null,
}:
stdenvNoCC.mkDerivation {
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
      (lib.fileset.fileFilter (f: f.hasExt "html") ../.)
    ];
  };

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    mkdir -p $out/share/dialogue $out/bin
    cp -r . $out/share/dialogue
    makeWrapper ${lib.getExe nodejs} $out/bin/dialogue-server \
      --add-flags $out/share/dialogue/server.js \
      --prefix PATH : ${lib.makeBinPath ([ nodejs git ttyd tmux openssh ] ++ lib.optional (omp != null) omp)}
  '';

  meta.mainProgram = "dialogue-server";
}
