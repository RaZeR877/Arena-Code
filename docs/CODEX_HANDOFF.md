# Vynqode IDE — Codex project handoff

Last prepared: 2026-10-30. This is a technical, non-secret summary of the project built over earlier ChatGPT development sessions. It **does not import the ChatGPT conversation history**; use it together with the repository source and tests. Revalidate all claims against the current commit before editing.

## 1. Owner's intended outcome

Turn **Vynqode** (formerly **Arena Code**) into a genuinely useful, polished AI-assisted coding IDE that can compete in *workflow quality* with modern coding environments, while keeping the default out-of-pocket budget at **₹0**.

Requirements established during development:
- **One coding interface**, not a coding competition. Remove/avoid all Battle, Side by Side, leaderboard, anonymous voting and multiple-response comparison concepts from the active UI.
- Professional visual design; the owner disliked overly plain, cramped, developer-demo UI. Prioritize typography, spacing, discoverability, useful panel resizing, keyboard shortcuts, responsive behavior, clear empty/loading/error states and refined visual hierarchy.
- User workflow: create/import project, open/search files, edit code, preview it, talk to a *single* AI coding assistant, request multi-file edits, inspect the diff, explicitly approve changes, run tests where execution is available, undo/recover, export or commit.
- Make AI substantially more useful through model choice, context selection, syntax checks, real tool feedback and honest benchmarks. Do not confuse large model support with demonstrated quality.
- Offer free browser/on-device AI where possible, plus **optional OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Groq, DeepSeek, Ollama, and compatible API providers**. API use may have charges; no provider credentials belong in a public static build.
- Prefer free/open-source components and locally runnable options; do not assume a paid VPS, inference subscription, hosted Docker daemon, or user API credits.
- Keep ownership and branding independent: Vynqode is the working product name. A preliminary name search is *not* trademark clearance. The GitHub repository name still uses the historical slug.

## 2. Repositories and deployment

- GitHub source repository: https://github.com/RaZeR877/Arena-Code
- Main branch: `main` — source of truth for the Node app, browser app, tests, docs and builds.
- Pages branch: `gh-pages` — static output.
- Public browser demo: https://razer877.github.io/Arena-Code/
- The existing repository is currently **public**. Do not commit secrets, credentials or private conversation content.
- The repository has not been renamed to `Vynqode` as of this handoff. A repo rename may require updating Pages links and settings; do not assume it is safe without checking.

At the time this handoff was prepared:
- The source `package.json` reports `vynqode` version `0.14.0`.
- Last inspected `main` commit *before the handoff docs*: `77fd9af9fbf41b5a8c5521001eca293fe0a1c570`.
- Last inspected `gh-pages` head: `7ed2a1ec1385f67014fe9edac44e4bce6f1199b8`.
- GitHub Actions reported success for the latest `Arena Code CI`, `Browser-only workspace E2E`, and `pages build and deployment` workflows at those commits.
- No full production Node + Docker + AI service is hosted on GitHub Pages. Never imply that the static site runs server-side code.

## 3. Current implementation map

### Active focused UI
- `public/index.html` — single IDE UI shell.
- `public/ide.js` — focused IDE controller, local project interactions and UI wiring.
- `public/ide.css`, `public/workbench.css` — styling/layout (v0.14 redesign).
- `public/browser-core.js` or its canonical counterpart under `pages/` — project ZIP, browser data and editor primitives; inspect imports to establish which source is authoritative.
- `public/ai-workflow.js` / `pages/ai-workflow.js` — model context selection and reviewed edits.
- `public/model-catalog.js` — WebLLM model availability/picker.
- `public/cloud-bridge.js` — client for the optional same-origin localhost API proxy.
- `scripts/build-pages.cjs` — builds the static website for Pages.

### Node and experimental server-side capabilities
- `server.js` — local HTTP backend, project and provider endpoints.
- `ai-providers.cjs` — OpenAI-compatible / Anthropic / Gemini provider requests and credentials lookup.
- `docs/API_PROVIDERS.md` — exact API routes, allowlists, security and setup.
- `hosted/`, `runner/`, `deploy/`, `project-checkpoints.cjs`, `evaluation/`, `public/workspace.js` and `public/editor.js` — legacy or separate hosted/workspace components. They may be partly implemented and tested, but are not necessarily integrated with the new focused IDE.
- `docs/REBRAND.md` — old screens retained in source but not active or included in the current Pages build.

### Other authoritative documents
- `README.md` — quick start, limitations and accumulated release history.
- `docs/AI_ENGINE.md` — WebLLM and browser AI evaluation notes.
- `docs/PAGES_DEPLOYMENT.md` — static site deployment constraints.
- `docs/REAL_E2E.md`, `docs/PREVIEW_ROUTING.md` — runner integration and verification boundaries.
- `SECURITY.md`, `IMPLEMENTATION_STATUS.md`, `ARCHITECTURE.md` — historical guidance that may be stale; compare to actual source.

## 4. What is usable now

**On GitHub Pages (static):** editable browser-local projects, file explorer, basic file searches/quick-open, HTML/CSS/classic-JavaScript preview inside a sandboxed iframe, basic syntax checks, ZIP import/export, simple undo, and optional on-device WebGPU/WebLLM inference. The assistant can propose bounded multi-file edits with approval; browser-local AI quality and device support vary.

**On localhost Node (`npm start`):** the focused UI plus optional AI provider proxy. Version 0.14 added an **API KEY** field under Connect AI on localhost. Keys are sent to the local backend and held in **server process memory for the session**, or read from environment variables. GitHub Pages intentionally does not show a usable key entry or execute paid API requests. The localhost bridge needs careful security validation if changed.

**Historical backend:** automated tests exist for a more extensive coding agent and Docker-backed execution/hosted features, but real Docker isolation, a production public host, large-project reliability and model-in-the-loop coding success are not proven by the earlier mock-heavy tests.

## 5. Known gaps — be frank

1. **Editor depth:** the active static IDE is not a complete Monaco/VS Code experience. Test actual editor implementation. Priority: strong syntax highlighting, autocomplete/diagnostics, tabs and navigation, keyboard behavior, responsive performance and diff review.
2. **Professional UI:** the latest owner feedback was that the UI remained unsatisfying. A cosmetic palette change alone is inadequate; improve the actual workflow through iterative desktop/mobile visual tests and user-facing interaction.
3. **Frontend vs backend split:** Pages cannot securely call paid provider APIs without a separate protected service. Localhost-only bridge is not a cloud-hosted proxy. Do not implement unsafe browser-side API key storage as a shortcut.
4. **Agent quality:** current tests validate structures, syntax and mock-provider flows, **not** real-model task-solving reliability. Benchmark real multi-file fixes, test execution and controlled recovery; log evidence and costs.
5. **Execution:** full integrated workflow of browser edit -> tool run -> repair -> live preview -> Git commit remains unfinished/unverified in a real isolated host. Docker runner tests using fake Docker do not prove isolation.
6. **Backend/hosting:** public hosting of multi-tenant accounts and execution requires abuse prevention, authentication, isolation, quotas, backup/restore and security review. Do not label production-ready without these.
7. **Repository naming/legal:** working name Vynqode not legally cleared; repository slug remains Arena-Code.

## 6. Development commands and validation

```bash
npm install
npm start
# Local UI: http://127.0.0.1:3000
npm run ci
npm run check:pages
npm run build:pages
# Browser smoke (Python Playwright + Chromium required):
python3 test/pages-browser.py
# Optional real-runner validation, only with a working Docker daemon:
npm run test:runner-e2e
# Optional agent evaluation; requires compatible real model and runner:
npm run eval -- --model <configured-model-id>
```

Document which tests were actually executed in the current environment. The five fixture checks and dry-run evaluation validate harness setup, not coding-agent skill. Do not modify evaluation contracts merely to make results pass.

The earlier development process had multiple green CI runs, but also browser CI failures caused by preview layout and test portability. Treat browser E2E as an important gate; investigate regressions rather than disabling assertions.

## 7. Prioritization suggested for Codex

Work incrementally, preserving the user's current project data.

**P0 — Inspect and establish baseline**
- Inspect source and current Pages build, verify CI and browser E2E, reproduce latest UI screenshots at desktop/mobile sizes, record findings.
- Identify dead legacy code vs active code to prevent fixes in the wrong UI.
- Check for secrets or inadvertent public exposure; keep current credential boundaries.

**P1 — Make the focused editor genuinely excellent**
- Introduce a reliable editor component and accessible file tabs/search/command palette if appropriate, without breaking local project persistence.
- Build a usable side-by-side diff review for AI edits and visible validation outcomes.
- Improve UI layout with thoughtful sizing, focus mode, panel resizing, preview usability and mobile states.
- Verify using real interaction tests and screenshots, not mock DOM snapshots alone.

**P2 — Finish the coding-agent vertical slice**
- Controlled project context and tools -> propose changes -> user-approved diff -> isolated tests (where backend is actually available) -> diagnose failure -> bounded repair loop -> recovery/commit.
- Keep model errors, retries, allowed operations, tool output and cost visible.
- Never claim agent-generated source was tested if it wasn't.

**P3 — API and local inference experience**
- Provider selection and explicit connection state, safe key rotation/removal, model discovery and errors.
- Make paid providers optional and explain billing; preserve user-controlled spending.
- Test real provider APIs only with opt-in user credentials. Add unit tests with fake responses for normal CI.

**P4 — Measured quality / security / deployability**
- Run a reproducible benchmark with a real model, report red/green test contracts, time, costs and failures.
- Test true Docker runner isolation and preview behavior separately from simulations.
- If public backend hosting becomes a goal, plan an affordable secure infrastructure option; GitHub Pages alone is not sufficient.

## 8. Suggested FIRST Codex task

> Read `AGENTS.md`, `docs/CODEX_HANDOFF.md`, `README.md`, and `docs/API_PROVIDERS.md`. Audit the current *active* Vynqode v0.14 UI and AI integration, then implement the highest-impact improvement to make it a professional single-workspace coding IDE. Preserve the zero-cost local-first path and secure API handling. Run `npm run ci`, `npm run check:pages`, `npm run build:pages`, and browser E2E where possible. Show a screenshot or clear before/after behavior, report exact test outcomes, and prepare a focused pull request. Do not implement Battle mode or move API keys into browser code.

## 9. Acceptance criteria for future milestones

A feature is **done** only when:
- It is reachable in the active focused Vynqode UI, not merely an unused legacy module.
- Its behaviors pass targeted tests; for user-facing UI, a real browser path is exercised.
- Errors, empty states and permission/cost boundaries are handled visibly.
- API keys and untrusted project files are handled safely.
- The relevant deployment target (static Pages vs localhost Node vs container host) is identified correctly.
- Docs, screenshots or example workflows agree with shipped behavior.
- Results accurately distinguish mocked tests from real execution.

## 10. Maintaining the handoff

Update this file and `AGENTS.md` as architectural choices change, and keep major assumptions actionable and concise. Never add private credentials, sensitive user information, personal chat history, or unverified claims to this **public repository**.

## First development audit follow-up

See [DEVELOPMENT_AUDIT.md](DEVELOPMENT_AUDIT.md) for verified gaps and test boundaries. The focused UI now has accessible open-file tabs and session-local cursor/scroll restoration. It still uses a textarea; legacy Monaco/debugging/runner features are not integrated. Navigation state is not stored in project data.

The modern workspace styling uses charcoal panels and warm accents, compact chrome, a header file finder, and responsive editor/agent sections. Styles live in `public/workbench.css`; both Node and Pages use the same active shell. This visual update does not integrate the legacy terminal or Monaco editor.

## Android/editor foundations

See [ANDROID.md](ANDROID.md). The active IDE now has an optional bundled Monaco surface, draft recovery, IndexedDB project snapshots, actual line-level AI diffs and visible syntax/context evidence. Its Tests dialog runs approved browser-project snapshots through the existing localhost Node runner and can place actual failure output into a repair prompt. This is user-controlled, not an autonomous repair benchmark. Capacitor supplies an Android debug APK build path and native ZIP sharing. Native device behavior remains unverified; a terminal, Android Node execution and integrated debugger remain unfinished. Browser and Android builds require `npm ci` for bundled assets. Root dependencies are locked. `evaluation/validate-fixtures.cjs` explicitly selects TAP to avoid Node reporter drift.


## Runtime, repair and release candidate follow-up

The active focused IDE now contains a real localhost PTY terminal with execution-copy export/import and a Node Inspector debugger with breakpoints, stepping, call stack and local values. Strict same-origin/loopback guards protect runtime APIs; server credentials are excluded from terminal child environments. Explorer/assistant panels support pointer and keyboard resizing. The repair loop saves recovery state, runs actual tests, requires approval for each patch, protects test contracts, limits corrections, and discards cancelled or stale results (including equal-revision project switches). Mechanism tests use mocked model responses, not a real-model capability benchmark.

Version 0.15 RC has a user-authorized new signing identity stored outside Git. Signed APK and AAB builds and their signatures were verified. See RELEASE_SIGNING.md for custody and backup; never replace that identity on a routine update. Native instrumentation is a separate gate from compilation/signing, and its current run results must be checked before claiming device readiness. The Android native workflow checks for nonzero executed tests.


## Verified completion of the runtime/release follow-up

The final code passed Node 20/22 CI, all five real Chromium workflows, signed release APK/AAB builds and signature checks. Native API 35 instrumentation passed at https://github.com/RaZeR877/Arena-Code/actions/runs/41045231521 (nonzero test enforcement enabled), covering recovery, snapshots, Monaco completion, native ZIP export/cancellation and preview-to-bridge isolation. Local software-emulator startup ANRs were distinguished from the successful accelerated run. PTY/debugger tools remain intentionally localhost Node features, not Android OS runtimes. Store upload, physical-device compatibility and actual model-solving performance remain separate validation scopes.
