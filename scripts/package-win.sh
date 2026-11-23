#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
repo_dir="$PWD"
version=45.4.1
cache_dir="${ELECTRON_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/fluxlab-electron}"
archive="electron-v$version-win32-x64.zip"
release_url="https://github.com/electron/electron/releases/download/v$version"
mkdir -p "$cache_dir" release
if [[ ! -s "$cache_dir/$archive" ]]; then
  curl --fail --location --retry 2 "$release_url/$archive" -o "$cache_dir/$archive.tmp"
  mv "$cache_dir/$archive.tmp" "$cache_dir/$archive"
fi
(cd "$cache_dir" && echo "2ba6223afa9121f42831fefe92c434334907540165294fc56697449d12e7cfe9  $archive" | sha256sum -c -)
npm run build
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/payload/resources/app"
unzip -q "$cache_dir/$archive" -d "$stage/payload"
mv "$stage/payload/electron.exe" "$stage/payload/FluxLab.exe"
rm -f "$stage/payload/resources/default_app.asar"
cp desktop/main.cjs desktop/package.json "$stage/payload/resources/app/"
cp -r dist "$stage/payload/resources/app/web"
cp desktop/FluxLab.ico "$stage/payload/FluxLab.ico"
python3 - "$stage" <<'PY'
import sys
from pathlib import Path
stage=Path(sys.argv[1])
payload=stage/'payload'
with (stage/'uninstall.nsh').open('w') as out:
 for p in sorted(payload.rglob('*'),key=lambda p:-len(p.parts)):
  path=str(p.relative_to(payload)).replace('/','\\')
  cmd='RMDir' if p.is_dir() else 'Delete'
  print(f'  {cmd} "$INSTDIR\\{path}"',file=out)
PY
"${MAKENSIS:-makensis}" -V2 "-DAPPICON=$repo_dir/desktop/FluxLab.ico" "-DPAYLOAD=$stage/payload" "-DUNINSTALL_FILES=$stage/uninstall.nsh" "-DOUTFILE=$repo_dir/release/FluxLab-1.0.0-Windows-x64-Setup.exe" scripts/installer.nsi
(cd release && sha256sum FluxLab-1.0.0-Windows-x64-Setup.exe FluxLab-Offline.html > SHA256SUMS.txt)
