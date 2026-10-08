#!/usr/bin/env bash
set -euo pipefail

# Run after dx build; pass a release binary path to register that build instead.
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app_binary="$(realpath -- "${1:-$project_dir/target/dx/infinite-editor/debug/linux/app/infinite-editor}")"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
test -x "$app_binary"
icon_dir="$data_dir/icons/hicolor/256x256/apps"
desktop_dir="$data_dir/applications"
mime_dir="$data_dir/mime"
mkdir -p -- "$icon_dir" "$desktop_dir" "$mime_dir/packages"
install -m 644 -- "$project_dir/assets/app-icon-256.png" "$icon_dir/infinite-editor.png"
install -m 644 -- "$project_dir/assets/infinite-editor-mime.xml" "$mime_dir/packages/infinite-editor.xml"
if command -v update-mime-database >/dev/null; then
    update-mime-database "$mime_dir"
fi

# Escape the quoted Exec argument according to the Desktop Entry specification.
exec_path="${app_binary//\\/\\\\}"
exec_path="${exec_path//\"/\\\"}"
exec_path="${exec_path//\$/\\\$}"
exec_path="${exec_path//\`/\\\`}"
exec_path="${exec_path//%/%%}"
# An absolute path avoids stale icon-theme caches on existing desktop sessions.
icon_path="${icon_dir//\\/\\\\}/infinite-editor.png"
mime_types=(
    application/x-infinite-editor-document text/markdown text/plain text/csv
    application/pdf application/rtf application/epub+zip
    application/msword application/vnd.ms-word.document.macroEnabled.12
    application/vnd.openxmlformats-officedocument.wordprocessingml.document
    application/vnd.ms-powerpoint application/vnd.ms-powerpoint.presentation.macroEnabled.12
    application/vnd.ms-powerpoint.slideshow.macroEnabled.12
    application/vnd.openxmlformats-officedocument.presentationml.presentation
    application/vnd.openxmlformats-officedocument.presentationml.slideshow
    application/vnd.ms-excel application/vnd.ms-excel.sheet.macroEnabled.12
    application/vnd.ms-excel.sheet.binary.macroEnabled.12
    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
    application/vnd.oasis.opendocument.text application/vnd.oasis.opendocument.spreadsheet
    application/vnd.oasis.opendocument.presentation
    application/wps-office.doc application/wps-office.docx
    application/wps-office.xls application/wps-office.xlsx
    application/wps-office.ppt application/wps-office.pptx application/wps-office.pot
)
mime_type_list="$(printf '%s;' "${mime_types[@]}")"
cat > "$desktop_dir/infinite-editor.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Infinite Editor
Comment=Document editor
Exec="$exec_path" %f
Icon=$icon_path
Terminal=false
Categories=Office;WordProcessor;
StartupWMClass=infinite-editor
MimeType=$mime_type_list
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
