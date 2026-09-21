# The app: static UI files plus server.js (Node builtins only, no npm deps).
{
  lib,
  stdenvNoCC,
  nodejs,
  unzip,
  makeWrapper,
}:
stdenvNoCC.mkDerivation {
  pname = "dialogue";
  version = (lib.importJSON ../package.json).version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../server.js
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
      --set DIALOGUE_UNZIP ${unzip}/bin/unzip
  '';

  meta.mainProgram = "dialogue-server";
}
