# Vynqode rebrand and single-interface architecture

**App name:** Vynqode. **Old app:** Arena Code. **Repo:** `RaZeR877/Arena-Code` until renamed through repository Settings > General > Repository name. This preserves links and the configured GitHub Pages deployment during migration.

## UI architecture

`public/index.html` loads only `browser-core.js`, `model-catalog.js`, `ai-workflow.js`, and `ide.js` plus `ide.css`. The Pages build uses the same interface. Its browser project is persisted at `vynqode-project-v1`, with a read-only fallback migration from `arena-pages-workspace-v1`.

The old `public/app.js`, `public/studio.js`, `pages/browser-workspace.js` and other historical screens remain in source only to avoid breaking backend tests/history; they are not loaded in the app and are excluded from Pages artifacts. Remove them after server-side agent endpoints have been migrated to the focused UI and all related tests updated.

## Trademark diligence

A preliminary general web search is not a registered trademark search and does not guarantee availability. Before a paid launch, check IP India trademark public search, WIPO Global Brand Database, the relevant classes and jurisdictions, and the intended domain/app-store listings. Seek professional legal review if material investment is planned.

## Future GitHub repository rename

1. Repository Settings → General → Repository name → change to `Vynqode` (not possible using the currently connected GitHub connector).
2. Update hardcoded GitHub links to `RaZeR877/Vynqode` and Pages URL to `https://razer877.github.io/Vynqode/`.
3. Confirm Pages Settings branch is `gh-pages` root and GitHub Actions deployment is green.
4. Do not discard the existing default branch; GitHub may redirect repository URLs but Pages URLs should be tested explicitly.
