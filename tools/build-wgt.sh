#!/bin/sh
# Builds the signed .wgt for Samsung Seller Office with the Tizen CLI.
#   1. Install Tizen Studio (with the TV extension) and create a Samsung certificate profile
#      in Certificate Manager (author + distributor certificates).
#   2. TIZEN_PROFILE=<profile name> sh tools/build-wgt.sh
# UNSIGNED=1 sh tools/build-wgt.sh makes build/MyPC-<version>.wgt with no signature (a plain zip, no Tizen
# Studio needed) for Apps2Samsung, which signs it with its own Samsung certificate for your TV.
# Only runtime files go into the package (no tools/, tests/, docs/).
set -e
cd "$(dirname "$0")/.."
OUT=build/wgt
rm -rf build
mkdir -p "$OUT"
node tools/validate-levels.mjs
cp -R config.xml index.html app.html app-manifest.json icon.png .nojekyll css js games sounds wallpapers data "$OUT"/
find "$OUT" -name '*.md' -delete
if [ -n "$UNSIGNED" ]; then
    VER=$(grep "viewmodes=" config.xml | sed "s/.* version=\"\([0-9.]*\)\".*/\1/")
    (cd "$OUT" && zip -qr -X "../MyPC-$VER.wgt" .)
    ls -la build/*.wgt
    exit 0
fi
tizen package -t wgt -s "${TIZEN_PROFILE:-arcade}" -- "$OUT"
ls -la "$OUT"/*.wgt
