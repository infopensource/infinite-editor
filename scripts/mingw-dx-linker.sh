#!/usr/bin/env bash
# Dioxus 0.7 emits MSVC subsystem arguments even for the MinGW target.
set -euo pipefail

link_args=()
for arg in "$@"; do
    case "$arg" in
        /SUBSYSTEM:WINDOWS) link_args+=("-mwindows") ;;
        /SUBSYSTEM:CONSOLE) link_args+=("-mconsole") ;;
        /ENTRY:mainCRTStartup) ;;
        *) link_args+=("$arg") ;;
    esac
done
exec x86_64-w64-mingw32-gcc "${link_args[@]}"
