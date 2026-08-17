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
