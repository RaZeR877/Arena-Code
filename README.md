# Arena Code 0.10.0

Arena Code is an independent, local-first AI coding workspace with an optional self-hosted multi-user mode. It has a multi-file project explorer, Monaco editor, built-in JavaScript/TypeScript intelligence, optional Language Server Protocol (LSP) connections, approval-based coding-agent tools, local Node debugging, file history, Git support, and Docker-backed build/test workflows. It is not affiliated with Cursor, Replit, or Arena.ai.

**This is a working development foundation, not a claim of full Cursor/Replit parity or production readiness.** Actual model quality, real Docker execution, hosted security, and deployment integrations must be verified in the target environment.

## What changed in v0.10.0

- GitHub Pages is no longer just an illustrative showcase: the browser-only edition now includes a multi-file text project explorer, saved local edits, project undo, standard ZIP import/export, code syntax checks and opaque-origin HTML/CSS/classic-JS previews.
- Users can load the existing browser-local WebGPU model and ask for a **reviewable, approval-based multi-file edit**. Edits are limited to five text files at a time; source is displayed side by side before approval. No remote code execution or model service is silently invoked.
- Added cross-language ZIP compatibility, malicious archive/path rejection, and a real Chromium UI smoke test with mocked model output, including red/green syntax, undo and preview. Real coding-model accuracy and server-side test execution remain separate validation milestones.
- GitHub Pages deployment now has an optional official Actions workflow, and the browser workflow has its own browser CI check.

**What v0.10.0 does not accomplish:** GitHub Pages still cannot run the server's Docker worker, authenticated multi-user collaboration, hosted Git tools, full language servers, or remote build/test commands. The browser editor is intentionally a lightweight textarea and is not a full Monaco/VS Code replacement. Live hosted deployment and real-model benchmark scores remain unverified.

## What changed in v0.9.0

- Hosted preview assets now stream through the private runner, up to 16 MiB per request, rather than returning 384 KiB of base64-wrapped JSON.
- An authenticated, allowed-port WebSocket bridge forwards raw upgrade/framed traffic to the isolated preview's loopback network namespace. A real Node HTTP+WebSocket protocol test and hosted authorization tests pass; **browser HMR remains limited by sandbox/origin restrictions**. See [`docs/PREVIEW_ROUTING.md`](docs/PREVIEW_ROUTING.md).
- Hosted start supports a controlled port allowlist (3000, 4173, 5173, 8000, 8080).
- Local **whole-project safety checkpoints** (latest eight, up to 8 MiB compressed per snapshot) save a rollback point before the coding agent starts. The Checkpoints panel can restore multiple source files together while preserving root-level `.git`, `.env*`, `.npmrc`, and installed dependencies. Hosted multi-user snapshots are not yet implemented.
- The real Docker verification command now exercises 1 MiB preview assets and WebSocket traffic in addition to the existing red/green test gate.
- Optional `npm run test:browser:agent` is a real Chromium interaction test with a mock coding-model provider and a deliberately failing-then-passing npm test. Requires Python Playwright and a browser whose local navigation is not restricted. This developer environment blocked Chromium navigation, so **this test has not passed here**. A manual GitHub Actions workflow is included for execution on a normal Ubuntu runner.

## GitHub Pages browser-only showcase

The site can be published from the `gh-pages` branch. See [`docs/PAGES_DEPLOYMENT.md`](docs/PAGES_DEPLOYMENT.md). This edition has starter templates, an editable HTML canvas, labeled demo responses, and optional WebGPU-powered in-browser AI. **GitHub Pages cannot host the Node server, multi-file coding agent, Docker runner, collaboration accounts, or hosted preview API.**

## Local quick start

Requirements: Node.js 20 or newer. Install dependencies to get the self-hosted Monaco editor assets; the editor can fall back to a CDN if those assets have not been built.

```sh
npm install
npm start
```

Open <http://127.0.0.1:3000>. On Windows, `start-arena-code.bat` is a convenience launcher; it does not replace installing dependencies when you need the bundled editor or hosted mode.

The server binds to `127.0.0.1` by default and refuses remote binding unless `ARENA_ALLOW_REMOTE=1` is explicitly set. Local mode has no login and is **not safe to expose publicly**. Project run/debug commands may execute source code as your OS user.

## Optional AI configuration

Set a provider key only in the server environment, never in browser code:

```sh
AI_API_KEY=your-key
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODELS=openai/gpt-4.1
```

`AI_BASE_URL` is the OpenAI-compatible API root, without `/chat/completions`. `AI_MODELS` is a comma-separated list of model IDs accepted by that provider. Restart Arena after changing values. Without `AI_API_KEY`, chat reports demo mode; demo/template responses are not real model output and the coding agent will not treat them as successful reasoning. You can also use the browser-local model path, where supported by your browser and GPU.

## Editor, completions, diagnostics, and debugging

- Monaco is copied from the npm package into `public/vendor/monaco` by the install script. Generated editor assets are not committed to source; install dependencies to self-host them.
- Monaco includes built-in JavaScript/TypeScript diagnostics and completions. For additional language intelligence, configure local language servers using [`docs/LANGUAGE_SERVERS.md`](docs/LANGUAGE_SERVERS.md). Browser requests cannot supply an executable name or command arguments.
- Local Node debugging is available for `.js`, `.cjs`, and `.mjs` files using **Debug Node file**. It starts Node Inspector bound to loopback and gives you a DevTools link for breakpoints, stepping, call stacks, and variable inspection. The inspector can evaluate code in the debugged process; debug trusted projects only.
- This is not yet a full VS Code implementation: there is no native cross-language debug adapter, integrated remote debugger, or complete language-server ecosystem.

## Project workspace

Open **Projects & coding agent** from the sidebar. Local projects live under `data/projects`; prior file versions live under `data/history` and project checkpoints live under `data/checkpoints`.

- Create projects or import a folder/standard ZIP, browse files, create/edit/delete files, review diffs/history, and export ZIP/JSON.
- Binary assets are preserved for preview and archive interchange but are not text-editable.
- Preview HTML in a sandboxed iframe; the preview does not grant same-origin access, but its scripts can still make outbound network requests.
- Use the Git panel for local init, status, diffs, staging, commits, and recovery.
- Open a source file and use **Check syntax**. JavaScript, JSON, and Python checks parse source without executing it.
- In local mode, **Checkpoints** captures a bounded whole-project ZIP snapshot before a risky change. An automatic checkpoint is attempted before starting each coding-agent task. Restore only after stopping active development processes. This protects editable project files; it is not an off-device backup and does not snapshot generated `node_modules`, secret files or Git history.

Archive paths are validated. Symlinks, traversal paths, duplicate/conflicting paths, secret-looking files (`.env*`, `.npmrc`, private keys), dependencies, Git internals, and generated directories are excluded or rejected. Current local limits are 500 files per project, 5 MiB per file, 100 MiB expanded project size, and 8 MiB compressed ZIP input.

## Coding agent

The coding agent uses the selected real browser model or configured server provider. Its bounded tool loop can inspect/list/search files, propose file creation/replacement, apply a unique exact-text patch, propose deletion, run syntax checks, and request user approval before writes/deletes/tests. It presents bounded change previews and handles stop requests between model steps. The model's assertion that a task succeeded is not accepted as proof: use actual check output and the evaluation suite.

The current benchmark suite includes five tasks (calculator edge case, slug normalization across modules, typed configuration across modules, quoted-field CSV parsing, and retrying API client across modules). Tests are immutable during scoring and the suite checks that each fixture starts red due to behavioral assertions.

## Builds, dependencies, and tests

The default local runner backend is `host`; this is convenient but runs `npm test` as your OS user. Do not test untrusted projects in host mode.

For more isolation, install Docker, pull the runtime images, and restart Arena with:

```sh
# pull the images required by the enabled workflows
docker pull node:22-alpine
docker pull python:3.12-slim

# Linux/macOS example; set the equivalent environment variables in Windows PowerShell before starting Arena
ARENA_EXECUTION_BACKEND=docker npm start
```

In Docker mode, Arena executes fixed npm and Python actions against a disposable project copy, imposes time/memory/CPU/PID limits, drops capabilities, uses a read-only container root, restricts networking for builds/tests, and caches dependencies separately. npm install has network access only in its disposable install container and ignores lifecycle scripts. Python dependency install uses binary wheels only. These are meaningful containment controls, not a guarantee that arbitrary hostile code is safe; validate on a real Docker host before exposing any execution service publicly.

Supported actions include JavaScript/JSON/Python syntax checks, npm dependency install/build/test, Python wheel dependency install, and Python unittest. Dependency install and build are disabled in host mode. Python tests also require Docker/remote-runner mode. Starting a local `dev`, `start`, or `preview` npm script and local Node Inspector is still host execution; only do so for code you trust.

Run the checks:

```sh
npm run ci
npm run test:ui  # optional; requires the installed Playwright dependency and a working browser
```

`npm run ci` performs JavaScript syntax checks, thirteen Node integration tests, deterministic benchmark-fixture integrity checks, and an evaluation-suite dry run. The runner tests use a fake Docker executable to inspect the requested container flags and exercise its LSP WebSocket protocol; they do **not** prove kernel/container isolation or replace a real Docker-daemon test.

To run model-in-the-loop evaluation, configure a real provider and `ARENA_EXECUTION_BACKEND=docker`, start Arena, and run:

```sh
npm run eval -- --model openai/gpt-4.1
```

The selected model must appear in `AI_MODELS`/`/api/status`. Each benchmark checks tests independently, verifies contract-test files were not changed, and writes results to `evaluation/results/latest.json`. Actual model evaluation is not claimed until you run it on your configured provider and runner.

## Self-hosted hosted mode

The optional Compose deployment provides a starting architecture for accounts, database-backed workspaces, owner/editor/viewer collaboration, per-file history, revision-aware writes, a dedicated isolated execution runner, optional hosted language servers, TLS termination, and deployment-adapter tracking.

Read [`docs/HOSTED_DEPLOYMENT.md`](docs/HOSTED_DEPLOYMENT.md) and [`docs/LANGUAGE_SERVERS.md`](docs/LANGUAGE_SERVERS.md) before deploying. In summary:

```sh
cp .env.hosted.example .env
# edit .env: set unique random database/runner secrets, domain, and any provider settings
docker compose --env-file .env -f deploy/compose.yaml up --build -d
```

The hosting operator must provide DNS/ports 80 and 443, PostgreSQL backups, updated images/dependencies, monitoring, quotas/cost controls, and incident response. The execution runner needs access to the host Docker socket, which is effectively host-root access; use a dedicated Linux VM and never publish the runner port to the public Internet.

Hosted deployment is adapter-based: configure an administrator-controlled endpoint with `ARENA_DEPLOY_WEBHOOK_URL` and `ARENA_DEPLOY_WEBHOOK_TOKEN`. Arena passes a bounded project archive and deployment metadata to this endpoint. The adapter must authenticate, validate/unpack safely, and hold provider credentials outside user project files. No Vercel/Netlify project credentials are built into Arena. Hosted projects can now run bounded, offline Docker previews through the private runner and authenticated `/api/projects/:id/preview` proxy. Preview responses can now stream up to 16 MiB and the private runner supports authenticated WebSocket upgrades on a fixed allowlist of ports, but same-origin sandbox restrictions mean generic embedded-browser HMR is **not** promised. See `docs/REAL_E2E.md` and `docs/PREVIEW_ROUTING.md`.

Public registration can be disabled with `ARENA_ALLOW_SIGNUP=0`. Current hosted mode has basic usage quotas but does not include email verification, password recovery, MFA, billing, a persistent PTY terminal, or a native hosted debugger; perform a security review before public use.

## Project layout

```text
server.js                  local API, project storage, Node Inspector, optional LSP
hosted/hosted.cjs          hosted accounts, DB workspaces, sharing, history, deployment adapter
runner/worker.cjs          authenticated Docker execution, isolated previews and LSP sessions
runner/preview.cjs         short-lived offline preview container lifecycle and HTTP bridge
runner/lsp/*.Dockerfile   administrator-built Python/TypeScript language-server images
public/editor.js           Monaco editor, completions/diagnostics, WebSocket LSP client
public/workspace.js        multi-file workspace and guarded coding-agent UI
evaluation/                 immutable contract fixtures and model-in-the-loop scorer
test/                      API/runner/hosted utility regression tests
deploy/                    Docker Compose and Caddy TLS reverse proxy
docs/                      hosted deployment and language-server setup
```

## Limits and honest status

Arena Code now has the foundations for local coding, container-backed fixed build/test actions, optional isolated hosted language servers, and self-hosted workspaces/collaboration. It is **not yet a full competitor** to Cursor or Replit: model quality is not benchmarked here, real Docker/GPU/production deployment have not been verified in this environment, hosted previews are limited to bounded HTTP GET/HEAD proxying, there is no native full-stack debugger, and production security/cost controls require additional work.

## v0.8: isolated hosted app previews and test-gated agent repair

See [the real Docker end-to-end guide](docs/REAL_E2E.md). The hosted editor can now start a workspace preview on the isolated runner, open it in a sandboxed iframe, and stop it. The agent seeks test evidence after file edits and may ask the model to repair failures; it never marks declined or missing tests as verified. Real model quality and real Docker are still deployment validation gates.
