# Development

## User settings

Desktop preferences are stored in a user-editable `settings.toml`:

- Linux: `$XDG_CONFIG_HOME/infinite-editor/settings.toml`, or
  `~/.config/infinite-editor/settings.toml` when XDG_CONFIG_HOME is unset.
- macOS: `~/Library/Application Support/infinite-editor/settings.toml`.
- Windows: `%APPDATA%/infinite-editor/settings.toml`.

See [settings.example.toml](settings.example.toml) for the configuration format.
Currently `[appearance].dialog_style` accepts `"a"` (native) or `"b"` (office).
The file is created on first launch, importing the old localStorage preference
when available. Existing settings files take precedence. UI changes save
automatically; restart after manual edits. Invalid files are reported rather
than overwritten. Saving preserves unknown fields, but reformats TOML and
does not preserve comments. Web builds continue using localStorage.

Document layout files and `Dioxus.toml` remain separate from user preferences.

## Document formats

Infinite Editor keeps Markdown as the source of truth and stores presentation
settings in a human-readable TOML sidecar:

```text
proposal.md
proposal.layout.toml
proposal.assets/
```

Opening `proposal.md` automatically loads `proposal.layout.toml` when it is
present and otherwise uses the default A4 layout. Saving a loose document writes
both files. Markdown-only export remains available for interoperability.
On desktop, dropping one supported file onto the editor opens it through the
same path as **Open With**. Markdown and `.infdoc` retain their file location;
PDF and Office documents are imported as unsaved documents. If the current
document has unsaved changes, the editor asks whether to save, discard, or
cancel before replacing it.

Portable `.infdoc` files are ZIP containers with a fixed manifest:

```text
proposal.infdoc
├── manifest.toml
├── proposal.md
├── proposal.layout.toml
└── proposal.assets/
```

The package reader validates entry paths, symlinks, file counts and expanded
sizes before reading content. Package saves are written to a temporary sibling
and then atomically replace the previous package. The format and layout schema
are independently versioned for future migrations.

### WYSIWYG editing

The paged document is the primary editor rather than a read-only preview.
The editable DOM updates immediately, while each input is committed as a
minimal Markdown transaction. Every transaction and render acknowledgement
carries a document revision and an edit revision, so an asynchronous older
render can never overwrite newer input. Automatic page fragments carry stable
block identifiers, so a paragraph split across physical pages is saved as one
Markdown paragraph. Only the explicit page-break marker is persisted.

The Home ribbon applies Markdown-compatible headings, paragraphs, emphasis,
strikethrough, code blocks, lists, quotes, and rules to the current selection.
The Insert ribbon can add a persistent page break. `Ctrl/Cmd+B` and
`Ctrl/Cmd+I` work directly inside the page.

Source and WYSIWYG modes share one CodeMirror `EditorState` transaction history.
WYSIWYG blocks carry their UTF-16 Markdown source ranges, so an edit replaces
only the affected source block while leaving unrelated Markdown spelling and
spacing untouched. Undo and redo operate on Markdown transactions in either
mode through the ribbon, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, or `Ctrl/Cmd+Y`.
The source editor, Rust parser, WYSIWYG renderer, and serializer all use the
same GFM dialect, including strikethrough and tables.

### Explicit page breaks

Paged layouts use real browser measurements to flow rendered Markdown across
physical pages. Add an explicit break without sacrificing Markdown compatibility
by placing this comment on its own line:

```md
<!-- infinite-editor:page-break -->
```

Other Markdown readers ignore the comment, while Infinite Editor starts the next
block on a new page. Seamless mode intentionally ignores explicit page breaks.

### Images, fonts, and export

Relative Markdown images are resolved from the layout's resource root in both
loose projects and `.infdoc` packages. A layout can also declare embedded fonts:

```toml
[resources]
root = "proposal.assets"

[[resources.fonts]]
family = "Source Han Sans SC"
path = "fonts/source-han-sans-sc.woff2"
weight = 400
style = "normal"
```

The editor converts supported images and fonts to in-memory URLs, so loose and
packaged documents use the same rendering path. PDF export generates a
self-contained print page, waits for images and fonts, applies the configured
physical page size, and prints it with an installed Chromium, Google Chrome, or
Microsoft Edge browser. The PDF is created as a temporary sibling and only
replaces the selected destination after successful validation.

DOCX and ODT export require Pandoc and the browser above. The browser first
lays out the document; Pandoc converts the resulting page fragments into
editable paragraphs, tables, images, and native math. The exporter writes
physical paper size, margins, typography, native three-column headers and
footers, first-page visibility, and dynamic page-number/total-page fields into
the Office package. Automatic and explicit browser page boundaries become
native page breaks. Fonts and line metrics can still vary between office
applications; the **PDF 精确版式** option preserves the rendered layout with
selectable text. Seamless documents use A4 for editable Office output.

PNG and JPEG export use the same browser layout at 150 DPI. One page uses the
selected filename; multiple pages use `proposal-1.png`, `proposal-2.png`, etc.
The **长图 PNG** option always uses the WYSIWYG editor's Seamless layout:
1120 CSS pixels wide, rendered at 2× resolution, without page gaps, header/footer
repetition, or page-break markers. Vertical tiles are streamed into one PNG
to avoid a full-document screenshot buffer. Choosing PNG while already in
Seamless mode also produces a long image. Export doesn't change the editor's
paper mode. PDF requires a fixed paper size; image export no longer needs
Poppler or an image-conversion executable.

## Build

Install the Rust toolchain and Dioxus CLI 0.7. The committed files in `assets/`
already contain the browser editor bundles. If you edit `web/editor.js`, run
`npm ci` once and `npm run build:editor` before building the application.

### Linux desktop

Install GTK 3 and WebKit2GTK 4.1 development libraries, then run:

```sh
dx serve --linux
dx build --linux --release
```

To appear in the file manager's **Open With** menu for Markdown, `.infdoc`,
PDF, Word, and other supported documents, register the desktop build for your
user account:

```sh
scripts/install-desktop-entry.sh target/dx/infinite-editor/release/linux/app/infinite-editor
```

This adds a desktop entry and a MIME definition for `.infdoc` without changing
the default application for existing document types. Rerun it after moving or
rebuilding the app at a different path.

### Windows x64 from Linux

Install MinGW-w64, `zip`, and the Windows GNU Rust target, then run:

```sh
rustup target add x86_64-pc-windows-gnu
scripts/build-windows-x64.sh
```

The script builds in release mode, includes the x64 `WebView2Loader.dll`, and
creates `target/dx/infinite-editor/release/windows/InfiniteEditor-0.1.0-windows-x64.zip`.
Extract the archive on Windows and run `app/infinite-editor.exe`. Microsoft Edge
WebView2 Runtime must be installed on that computer. The MinGW linker wrapper in
`scripts/mingw-dx-linker.sh` translates the Windows subsystem flags emitted by
Dioxus CLI for this target.

To add **使用 Infinite Editor 打开** to the file context menu, keep the extracted
`app/` directory in a permanent location, then run the bundled
`register-windows-context-menu.ps1` in PowerShell. It registers supported
Markdown, `.infdoc`, PDF, Office, and other import formats for the current user.
From the extracted archive directory, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\register-windows-context-menu.ps1
```

Windows 11 may show the command under **显示更多选项**. Run the same script with
`-Unregister` to remove the entries, or rerun it after moving the `app/` directory.
Choosing `infinite-editor.exe` from **打开方式** also opens the selected file without
registering the context menu. Imported formats open as unsaved documents; save
them as `.md` or `.infdoc` to keep edits.

### macOS desktop

On macOS with the Apple command line tools installed, run:

```sh
dx build --macos --release
```

### Web

Install the WebAssembly Rust target and build without the default desktop
feature:

```sh
rustup target add wasm32-unknown-unknown
dx build --web --no-default-features --features web
dx build --web --release --no-default-features --features web
```

The Web build does not include native file dialogs, local filesystem actions,
or desktop export tools. Release builds also need a writable Dioxus CLI tool
cache for its `wasm-opt` executable.

## Tests

```sh
npm ci
npm test
cargo clippy --all-targets --features desktop -- -D warnings
cargo check --target x86_64-pc-windows-gnu --features desktop
cargo check --target wasm32-unknown-unknown --no-default-features --features web
```
