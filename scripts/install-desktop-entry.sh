#!/usr/bin/env bash
set -euo pipefail

# Run after dx build; pass a release binary path to register that build instead.
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app_binary="$(realpath -- "${1:-$project_dir/target/dx/infinite-editor/debug/linux/app/infinite-editor}")"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
test -x "$app_binary"
icon_dir="$data_dir/icons/hicolor/256x256/apps"
desktop_dir="$data_dir/applications"
mkdir -p -- "$icon_dir" "$desktop_dir"
install -m 644 -- "$project_dir/assets/app-icon-256.png" "$icon_dir/infinite-editor.png"

# Escape the quoted Exec argument according to the Desktop Entry specification.
exec_path="${app_binary//\\/\\\\}"
exec_path="${exec_path//\"/\\\"}"
exec_path="${exec_path//\$/\\\$}"
exec_path="${exec_path//\`/\\\`}"
exec_path="${exec_path//%/%%}"
# An absolute path avoids stale icon-theme caches on existing desktop sessions.
icon_path="${icon_dir//\\/\\\\}/infinite-editor.png"
cat > "$desktop_dir/infinite-editor.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Infinite Editor
Comment=Document editor
Exec="$exec_path"
Icon=$icon_path
Terminal=false
Categories=Office;WordProcessor;
StartupWMClass=infinite-editor
EOF

if command -v update-desktop-database >/dev/null; then
    update-desktop-database "$desktop_dir"
fi
if command -v gtk-update-icon-cache >/dev/null && [[ -f "$data_dir/icons/hicolor/index.theme" ]]; then
    gtk-update-icon-cache -f -t "$data_dir/icons/hicolor"
fi
if [[ "${XDG_CURRENT_DESKTOP:-}" == *KDE* ]]; then
    if command -v kbuildsycoca6 >/dev/null; then
        kbuildsycoca6 --noincremental
    elif command -v kbuildsycoca5 >/dev/null; then
        kbuildsycoca5 --noincremental
    fi
fi
printf 'Installed %s\n' "$desktop_dir/infinite-editor.desktop"
