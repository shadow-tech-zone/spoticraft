#!/usr/bin/env bash
# Zig cross-build (Windows target) — bina MSVC ke compile+link verify.
# Istemaal: ZIG=/path/to/zig bash tools/build-zig.sh  (default: /tmp/zigpkg/ziglang/zig)
set -e
cd "$(dirname "$0")/.."
ZIG="${ZIG:-/tmp/zigpkg/ziglang/zig}"
mkdir -p build
for f in main ui net api player state; do
  echo "== $f.cpp"
  "$ZIG" c++ -target x86_64-windows-gnu -std=c++17 -DUNICODE -D_UNICODE -O1 -c "$f.cpp" -o "build/$f.o"
done
"$ZIG" c++ -target x86_64-windows-gnu -mwindows -municode \
  build/main.o build/ui.o build/net.o build/api.o build/player.o build/state.o \
  -o build/Bloomee-zig.exe \
  -ld2d1 -ldwrite -lwindowscodecs -lwinhttp -lmfplat -lmfreadwrite -lmfuuid \
  -lole32 -luuid -lshell32 -lshlwapi -ldwmapi -lcomctl32 -luser32 -lgdi32 -ladvapi32 -loleaut32
echo "OK -> build/Bloomee-zig.exe (icon/manifest ke liye MSVC build recommended: build.cmd)"
