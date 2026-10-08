#!/usr/bin/env bash
# Build a portable Windows x64 app from Linux with Rust, MinGW, dx, and zip.
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
target_dir="${CARGO_TARGET_DIR:-target}"
if [[ "$target_dir" != /* ]]; then
    target_dir="$project_dir/$target_dir"
fi
version="$(cargo pkgid --offline --locked)"
version="${version##*#}"

export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="$project_dir/scripts/mingw-dx-linker.sh"
dx build --windows --release --target x86_64-pc-windows-gnu --locked

build_root="$target_dir/x86_64-pc-windows-gnu/desktop-release/build"
loader="$(find "$build_root" -path '*/webview2-com-sys-*/out/x64/WebView2Loader.dll' -print -quit)"
if [[ -z "$loader" ]]; then
    echo 'WebView2Loader.dll was not found in the build output' >&2
    exit 1
fi

windows_dir="$target_dir/dx/infinite-editor/release/windows"
cp "$loader" "$windows_dir/app/WebView2Loader.dll"
cp "$project_dir/scripts/register-windows-context-menu.ps1" "$windows_dir/register-windows-context-menu.ps1"
archive="$windows_dir/InfiniteEditor-$version-windows-x64.zip"
rm -f "$archive"
(cd "$windows_dir" && zip -q -r -9 "$(basename "$archive")" app register-windows-context-menu.ps1)
echo "$archive"
