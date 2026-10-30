# Development audit — 2026-10-30

Baseline: cc0f5f8. This is an architecture and workflow audit, not an exhaustive security certification. Reviewed the active UI, browser project/AI modules, provider bridge and server routes, legacy editor/workspace wiring, runner/hosted boundaries, manifests, deployment workflows, documentation and test coverage.

| Priority | Finding and evidence | Status / next action |
| --- | --- | --- |
| P1 | Active `public/index.html` loads `ide.js` with a textarea. Monaco, autocomplete/LSP and debugging in `public/editor.js` are separate legacy functionality. | Not integrated. Introduce an editor adapter before connecting richer editor models to persistence and AI approval. |
| P1 | Opening another file resets selection/scroll; no open-file navigation. | This change adds keyboard-accessible tabs and per-file in-session selection/scroll restoration. Switching still saves first; failed saves retain the current file. Project replacement resets navigation state. |
| P1 | Unsaved text has no navigation-away warning. | This change adds a standard beforeunload guard. Browser/mobile lifecycle limits still apply; this is not crash recovery or automatic saving. |
| P1 | Active agent proposes up to five files with syntax checking and one retry, but cannot run tests or repair from execution feedback. | Existing mock-provider tests prove contracts, not real model quality. Do not label this a complete autonomous agent. |
| P1 | Terminal, Git, Node debugging and execution APIs are not connected to browser-local projects. | A workspace storage/execution adapter is needed; do not attach arbitrary shell execution to the static UI. |
| P1 | `preview()` inlines CSS and classic scripts, but excludes module scripts and does not resolve arbitrary asset/module graphs. | Framework apps need an actual isolated runner or a separately designed browser build pipeline. |
| P2 | `public/browser-core.js` and `pages/browser-core.js`, and corresponding AI modules, are identical duplicate sources. Node serves public; Pages build copies pages. | Avoid divergent fixes; consolidate with parity tests in a later focused change. |
| P2 | Historical app, studio and workspace screens remain; older status docs describe capabilities absent from the default interface. | Preserve source until endpoints/tests are migrated; do not present these as active UI features. |
| P2 | One current project and one undo snapshot; editing/switching rewrites browser storage. | No multi-project catalog, durable history or cross-tab conflict resolution. Keep ZIP backups and storage migration compatibility. |
| P2 | No root lockfile; CI installs dependency ranges. | Builds are not dependency-reproducible. Adopt and review a lockfile separately. |
| P2 | Node 24 default reporter breaks fixture validation's TAP-specific parsing. | Node 22 is verified. Fix harness reporter selection explicitly before claiming all Node >=20 versions work. |
| P2 | Pages publishing workflow is manually dispatched; `gh-pages` and source remain separate. | This PR does not deploy or rename the repository. |

## Preserved boundaries

Provider credentials remain in the Node process/environment. Session credential routes require loopback and same-origin requests. The browser uses same-origin requests; no keys were added to source or browser storage. Provider HTTP tests use fake upstreams. Preview remains sandboxed. No mandatory paid dependency or inference call was introduced.

## Validation of this change

- Node 22.23.4: `npm run ci` passed (14 Pages tests, 37 integration tests, five intentionally failing behavioral fixture baselines, evaluation dry run).
- `npm run build:pages` passed.
- `python3 test/pages-browser.py` passed in actual Chromium over HTTP, including file tabs, selection restoration, saving on switch, Home/End keyboard navigation, syntax checks, undo, interactive preview, mock AI correction/approval, ZIP export and desktop/mobile layout.
- Browser screenshots are generated under ignored `test-results/`; no credentials or model calls are used.
- Real AI providers, WebGPU inference, Docker isolation, hosted PostgreSQL and production deployment were not exercised. A browser smoke test is not a full accessibility audit.

Tabs and cursor state are session-local and are not added to the persisted project schema. Tab closing/reordering, full syntax highlighting, autocomplete, integrated terminal and debugger remain unfinished.
