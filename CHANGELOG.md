# v0.10.0 — Usable browser coding workspace

- Replaced the Pages-only “backend unavailable” project hub with a local multi-file workspace, preview, text-file ZIP exchange, basic checks, and undo.
- Added approval-based browser-AI multi-file edit suggestions and a before/after review surface.
- Added 6 source-core tests, Pages structural coverage, and an actual Chromium workflow against the static artifact.
- Retained clear limits: no server-executed tests, cloud hosting, Git sync or Docker on Pages; actual model quality requires live benchmarking.

# Arena Code v0.9.0 — 2026-10-29

### Execution and previews
- Added a bounded binary HTTP preview stream (16 MiB maximum per request) through the authenticated hosted app and private runner, replacing the 384 KiB base64 JSON bottleneck.
- Added a token-protected runner WebSocket tunnel with application-side cookie/workspace/origin authorization and a fixed preview-port allowlist (3000, 4173, 5173, 8000, 8080).
- Enhanced the real-Docker red/green verification script to exercise a 1 MiB HTTP asset and WebSocket upgrade/frame; the script is **not** claimed to have passed without an actual Docker daemon.
- Documented strict iframe sandbox-origin constraints: the WebSocket transport works in isolated protocol tests, but generic Vite/Next.js embedded HMR is not yet a supported browser feature.

### Agent recovery and evaluation
- Added local full-project checkpoints (8 retained, 8 MiB compressed maximum) with explicit restoration and safe protection of root-level Git metadata, local environment files and installed dependencies.
- The browser agent automatically attempts a recovery checkpoint before a local task; checkpoint failure is reported instead of hidden.
- Added optional browser agent red/green workflow using a deterministic mock provider and actual npm test outcomes. Added a manually dispatched GitHub Actions browser job; Chromium navigation was blocked by the build environment's policy and was **not** validated locally.

### Validation and boundaries
- Thirteen Node integration tests passed, including real Node-to-Node HTTP/WebSocket protocol tests with a simulated Docker bridge, hosted authorization/streaming tests and multi-file checkpoint restoration.
- Five benchmark fixture baselines validated and a dry-run passed; no real-provider model pass rate, dedicated Docker host, or public deployment is claimed.

# Arena Code v0.8.0

- Hosted preview runner with offline, read-only Docker containers, strict resource limits, TTL and teardown.
- Authenticated workspace-aware HTML/asset proxy, sandboxed in-editor preview and start/stop actions.
- Agent completion gate: run approved `npm test` after edits, provide failures to model for limited repairs, never claim success when unverified.
- Real-Docker red/green/preview verification script (`npm run test:runner-e2e`) and preview lifecycle/security unit and integration coverage.
- No public infrastructure, live provider pass rate, or real Docker daemon is claimed from the build environment.

## 0.7.0 — Hosted operations foundations

- Added database-backed daily chat, run and deployment request quotas, per-user workspace cap and authenticated usage endpoint.
- Added liveness and database readiness endpoints.
- Added operator-controlled PostgreSQL backup/restore scripts and operational runbook.
- These are incremental reliability controls, not completed production deployment, password recovery, live model evaluation, or Cursor/Replit parity.

# Changelog

## 0.6.0 — 2026-10-29

### Added
- Monaco-based editor bootstrapped from npm and optionally self-hosted under `public/vendor/monaco`, with built-in JS/TS IntelliSense and an LSP client for completions, hover, definition and diagnostics.
- Local administrator-configured LSP process support plus isolated hosted Python and TypeScript LSP sessions through the private runner. Sessions have allowlisted methods, fixed commands, read-only source mounts, network disabled, resource limits, and idle cleanup.
- Dedicated Python/TypeScript LSP Dockerfiles and operational setup guide.
- Docker-backed fixed workflows for npm install/build/test and Python wheel install/unittest, with a dependency cache, read-only cache mounts, and explicit network separation between install and test/build actions.
- Five model-in-the-loop benchmark fixtures and a deterministic validator proving each baseline fails on behavioral assertions rather than a missing module or syntax error. Added a multi-file retrying API client scenario.
- Self-hosted deployment/runbook guidance for PostgreSQL-backed accounts/workspaces, collaboration roles, revision-aware edits, runner wiring, TLS proxy, and the deployment webhook adapter.

### Improved
- Connected the hosted app's `/api/lsp` WebSocket route to the private runner after checking session authentication and workspace access.
- Reused a connected LSP session when switching files within the same project/language rather than starting a new language server for each file.
- Made the hosted runner reject projects whose compressed archive exceeds its supported size before sending the request.
- Expanded CI to install dependencies/self-host editor assets and run syntax, integration, fixture-integrity, and evaluation dry-run checks.

### Validation
- `npm run ci` passed in this environment: syntax checks, eight Node integration tests, five fixture validation runs, and evaluation-suite dry run.
- Runner WebSocket testing uses a fake Docker executable; real Docker, real LSP binaries, live browser UI, public TLS deployment, PostgreSQL hosted flows, provider model evaluation, and deployment webhooks remain unverified here.

## 0.4.0 — 2026-10-29

### Added
- Standard ZIP project import/export using a dependency-free ZIP32 utility with bounds checks, CRC verification, path-traversal protections, and rejection of encrypted archives, symlinks, and special files.
- Explicit project app lifecycle controls for the conventional `dev`, `start`, and `preview` npm scripts, with confirmation, localhost port selection, bounded output logs, polling, stop controls, and shutdown cleanup.
- Agent exact-text patch actions, plus JSON and Python syntax checks.
- GitHub Actions CI across Node.js 20 and 22, a security policy, issue template, editor configuration, and an authenticated GitHub CLI helper for creating a new private repository and pushing the source.

### Improved
- Split chat and general API rate-limit buckets so workspace activity does not consume the chat request allowance.
- Tightened ZIP local/central header checks and rejected crafted traversal entries.
- Updated setup, security, execution-boundary, test, and implementation-status documentation.

### Validation
- `npm run ci` passed: syntax checks plus four Node integration tests.
- A generated ZIP was also read successfully from a standard system ZIP tool.
- Provider tests use a mock endpoint; the Docker integration test uses a fake Docker CLI. Real model/GPU inference, a live Docker daemon, cloud hosting, and a full browser end-to-end run are not claimed as verified.
