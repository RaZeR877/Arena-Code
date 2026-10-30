# AGENTS.md — Vynqode IDE

Read [docs/CODEX_HANDOFF.md](docs/CODEX_HANDOFF.md) before undertaking substantial changes. Also inspect current source and tests; this file is a guide, not a substitute for verification.

## Product
- Product name: **Vynqode IDE** (formerly Arena Code). GitHub repository is still `RaZeR877/Arena-Code`; do not silently rename the repository or break the Pages URL.
- Build a polished, usable, **single-interface** AI coding IDE. No Battle mode, voting, leaderboards, anonymous model comparison, or unrelated starter-chat product.
- User wants a professional coding experience: code explorer, editor, preview, clear project navigation, capable AI assistant and reviewed edits. The user found previous versions too basic; prioritize usability and visual refinement.
- **₹0 default budget.** Prefer free/open-source/local tooling and avoid mandatory paid hosting or APIs. Optional user-supplied cloud API keys are allowed. Be candid about performance, cloud costs and infrastructure limits.

## Current architecture
- The canonical focused IDE is in `public/index.html`, `public/ide.js`, `public/ide.css`, and `public/workbench.css` with supporting `public/browser-core.js`, `public/ai-workflow.js`, `public/model-catalog.js`, and `public/cloud-bridge.js`.
- `scripts/build-pages.cjs` builds `dist/pages` for the static GitHub Pages edition.
- `server.js` and `ai-providers.cjs` implement localhost-only API provider features. See `docs/API_PROVIDERS.md`.
- Historical app/hosted/runner code remains in the repo but is NOT automatically exposed by the focused IDE. Audit before reusing it.
- `gh-pages` publishes the static browser-only edition. Static Pages cannot run Node.js, Docker, remote terminals, or a secure cloud API-key proxy.

## Safety and correctness rules
- Never place AI API keys, tokens, or secrets in committed files, browser source, GitHub Pages, console logs, test snapshots, URLs, or generated examples.
- Preserve same-origin and loopback security controls for session-only API keys, and require approval for AI edits. Treat model output and imported project files as untrusted.
- Do not claim model capability, Docker sandboxing, real cloud deployment, test success, or security audits unless actually exercised. Distinguish fake-provider/mock-model tests from real-model evaluations.
- Keep browser-local project persistence, ZIP import/export, preview isolation, basic syntax checks, undo and API setup functional.
- Preserve `main` source and the separate Pages publishing workflow; review CI and deployment status when changing UI assets.
- Do not silently introduce subscription costs or depend on paid services.

## Validation
1. `npm install` (Node 20+)
2. `npm run ci` (syntax, integration and evaluation dry-run)
3. `npm run check:pages && npm run build:pages`
4. Optional real browser test: `python3 test/pages-browser.py` (requires Python Playwright and Chromium)
5. Test server-only provider behavior without leaking keys; test actual providers only with user-provided, non-committed credentials.
6. Summarize precisely what passed, what was mocked, and what remains untested.

## Working style
- Start with a short inspection/plan, implement actual code, run tests, and explain meaningful changes. Prefer a complete functioning vertical slice over accumulating unverified feature flags.
- Use clear, maintainable code and minimal new dependencies.
- For each major change, verify responsive desktop/mobile behavior and accessibility.
- Consult `docs/CODEX_HANDOFF.md` for the complete history, goals, known gaps, release commands and priorities.
