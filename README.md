# Development

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

### Images, fonts, and PDF

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

Your new jumpstart project includes basic organization with an organized `assets` folder and a `components` folder.
If you chose to develop with the router feature, you will also have a `views` folder.

```
project/
├─ assets/ # Any assets that are used by the app should be placed here
├─ src/
│  ├─ main.rs # The entrypoint for the app. It also defines the routes for the app.
│  ├─ components/
│  │  ├─ mod.rs # Defines the components module
│  │  ├─ hero.rs # The Hero component for use in the home page
│  ├─ views/ # The views each route will render in the app.
│  │  ├─ mod.rs # Defines the module for the views route and re-exports the components for each route
│  │  ├─ blog.rs # The component that will render at the /blog/:id route
│  │  ├─ home.rs # The component that will render at the / route
├─ Cargo.toml # The Cargo.toml file defines the dependencies and feature flags for your project
```

### Serving Your App

Run the following command in the root of your project to start developing with the default platform:

```bash
dx serve
```

To run for a different platform, use the `--platform platform` flag. E.g.
```bash
dx serve --platform desktop
```

## Tests

Install the locked JavaScript dependencies once:

```sh
npm ci
```

Run the CodeMirror DOM tests and Rust unit tests together:

```sh
npm test
```

After changing `web/editor.js`, rebuild the offline browser bundle and verify the
desktop package:

```sh
npm run build:editor
cargo clippy --all-targets --features desktop -- -D warnings
dx build --platform desktop
```
