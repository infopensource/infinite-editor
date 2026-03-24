# Commit Message Guide (Conventional Commits)

Use this format for clean, searchable history.

## Format

```
<type>(optional-scope): <subject>

<body>

<footer>
```

## Allowed Types

- `feat` — a new feature
- `fix` — a bug fix
- `docs` — documentation only
- `style` — formatting, no logic change
- `refactor` — code change without feature/fix
- `perf` — performance improvement
- `test` — add or update tests
- `build` — build system or dependencies
- `ci` — CI/CD changes
- `chore` — maintenance tasks
- `revert` — revert a previous commit

## Subject Rules

- Use **imperative mood**: `add`, `fix`, `remove`, `refactor`
- Keep it short (recommended <= 72 chars)
- Do not end with a period
- Use scope when useful: `feat(editor): ...`

## Body Rules

In the body, explain:

1. **What changed**
2. **Why it changed**
3. **Impact or trade-offs**

Keep lines readable (around 72 chars per line).

## Footer Rules

Use footer for issue links or breaking changes.

Examples:

- `Closes #42`
- `Refs #108`
- `BREAKING CHANGE: renamed public API from X to Y`

## Good Examples

### 1) Feature

```text
feat(editor): add Word-style ribbon tab switching

- render tabs from enum to simplify future extension
- persist active tab with signal for predictable re-rendering
- keep ribbon panel height stable across tab changes

Closes #12
```

### 2) Fix

```text
fix(title-bar): prevent blur race after Escape in search box

- route Enter/Escape/blur to a single finalize function
- ignore late blur events when editing has already ended
- keep Escape behavior deterministic (clear + exit)

Refs #34
```

### 3) Refactor

```text
refactor(word): split title bar logic into focused components

- extract editable title and search box into dedicated functions
- reduce coupling in root title bar component
- keep behavior unchanged while improving maintainability
```

## Quick Template

```text
<type>(<scope>): <subject>

- what changed
- why it changed
- impact / notes

Refs: #<issue-id>
```

## Optional: Enable Git Commit Template

```bash
git config commit.template .gitmessage.txt
```

Then run:

```bash
git commit
```

Git will open the pre-filled template in your editor.
