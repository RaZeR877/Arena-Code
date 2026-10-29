# Implementation status — Arena Code 0.9.0

This is the implemented source status, not a claim of full Cursor/Replit parity. Features marked as implemented in the source still require real environment validation where noted.

## Phase status

### P0 — Baseline security and reliability: foundations implemented

- Local mode binds to loopback by default and requires an explicit opt-in for remote binding.
- Request validation/limits, independent chat/API rate-limit buckets, server-side provider keys, bounded provider calls, restricted static files, and origin checks.
- Local and hosted project path rules reject traversal, reserved secrets, symlinks where filesystem APIs are involved, duplicate/conflicting archive paths, invalid ZIP headers, and oversized content.
- Remaining: independent threat modelling, fuzzing, dependency scanning, audit, and production incident controls.

### P1 — Professional editor foundation: implemented, not full VS Code parity

- Monaco editor is installed from npm and served locally through generated `public/vendor/monaco` assets, with a textarea fallback when assets fail to load.
- Built-in JavaScript/TypeScript IntelliSense and syntax diagnostics; additional language completion, hover, definition, and diagnostics can flow through an LSP WebSocket bridge.
- Local language servers can be configured by the administrator. Hosted mode supports optional Python and TypeScript LSP containers launched by the private runner, with a fixed executable allowlist, no container networking, read-only workspace mount, resource limits, idle expiry, and session cleanup.
- Local Node debugging launches Node Inspector on loopback and exposes a DevTools link for breakpoints, stepping, stack frames and variables.
- Remaining: real language-server package/hardware/browser validation, refactoring/edit support, a fully native debugger adapter, remote debugger, and broad language/toolchain support. Hosted LSP images are not built automatically; the operator must build and configure them.

### P2 — Multi-file coding agent and evaluation: foundation implemented

- Agent can inspect/list/search project files, propose file writes/deletes, apply exact-text patches, ask for approval, run syntax checks and request approved tests. Stop is checked before subsequent tool actions are applied.
- Five benchmark fixtures cover calculator behavior, slug normalization across modules, typed config across modules, quoted CSV parsing, and a retrying API client across modules. Contract tests are excluded from edits and checked for preservation; each fixture is validated to start red from behavioral assertions rather than syntax/load errors.
- `npm run eval -- --model <configured-model>` is a model-in-the-loop benchmark requiring a real AI provider and isolated runner. No model task pass-rate is claimed in this source-only session.
- Remaining: schema-based function calling across providers, resumable long tasks, context indexing, stronger semantic patches, cancellation during in-flight provider requests, expanded language/codebase suite, and scored runs on real models/hardware.

### P3 — Container-isolated build/test/dependency workflows: implementation added, live Docker validation required

- Dedicated runner performs fixed npm install/build/test, Python wheel-only dependency installation/test, JS/Python syntax checks, and optional language-server sessions in disposable containers.
- Containers request a read-only root, no-new-privileges, dropped capabilities, CPU/memory/PID limits, bounded output and timeouts. Build/test containers deny network access. Dependency installation is a separate disposable step with network access; npm lifecycle scripts are disabled and Python uses binary wheels only. Dependency caches are keyed by dependency manifests and mounted read-only to build/test jobs.
- Local host mode remains available, but arbitrary npm tests and developer scripts execute as the OS user. Hosted `/process` now proxies only start/stop to the private Docker runner. Preview containers run offline and on a read-only project snapshot; do not execute user apps inside the web server.
- Remaining: real Docker-daemon tests, disk/I/O quotas, adversarial container escape validation, build system matrix, generic browser HMR on an isolated preview origin and high-throughput production preview routing. The v0.9 runner streams bounded HTTP assets and tunnels authenticated WebSocket frames on allowed ports; sandboxed iframe origins still prevent generic HMR.

### P4 — Daily-use developer workflow: foundations implemented

- Multi-file project explorer, editor, file history, ZIP/JSON import/export, Git actions, HTML preview, JS/JSON/Python syntax checks, app lifecycle for local npm scripts, and Node Inspector.
- Optimistic revision checks on hosted edits help detect collaborator conflicts. Hosted workspace file history is persisted in PostgreSQL.
- Remaining: interactive PTY terminal, full language-server installation management, language-specific debugging, a full browser-compatible preview origin, dependency lockfile/upgrade policy, and broader browser end-to-end coverage. Local full-project checkpoints now support rollback, but hosted multi-user checkpointing is not implemented.

### P5 — Self-hosted accounts, collaboration, deployment: starter architecture implemented

- PostgreSQL-backed accounts and cookie sessions, sign-up/login/logout, cloud workspaces, owner/editor/viewer roles, sharing, revision-aware edits, file history, status/limits, and deployment request tracking.
- `deploy/compose.yaml` wires the Caddy TLS proxy, app, PostgreSQL and separate runner into private networks. Caddy requires public DNS and ports 80/443. Hosted app dependencies are installed during Docker build.
- Deployment uses an admin-provided webhook adapter. Hosted build/test and LSP requests go to a private authenticated runner. Hosted preview/start-process routes now use bounded, offline, disposable Docker containers through the private authenticated runner. Only fixed loopback ports can be routed; there is no general public port forwarding or production-ready arbitrary framework HMR.
- Remaining: real deployment on a dedicated VM, production security review, email verification/password recovery/MFA, quotas/billing, audit logs/metrics/alerting, backups/restore, abuse protections, provider-specific integrations, and verified operational costs. The runner's Docker socket access is host-root-equivalent.

## Validation for this source revision

- `npm run ci` has passed in the development environment: JavaScript syntax checks, thirteen Node integration tests, benchmark fixture integrity (five tasks start red by assertion), and the evaluation dry run.
- The runner integration test uses a fake Docker CLI. It verifies auth, fixed command arguments, network/read-only flags, dependency cache behavior, and the LSP WebSocket framing path. Preview lifecycle and HTTP-proxy mock tests also pass. These do not prove actual Docker isolation.
- A new browser agent end-to-end test script and manually dispatched CI job were added, but the local Chromium browser was blocked from navigating by administrator policy. Do not count the browser script as passed; rerun it on unrestricted CI or a development machine.
- Real WebGPU model inference, real local/hosted language servers, a live Docker daemon, PostgreSQL-backed account flows, Caddy TLS on a public domain, and a real deployment webhook have not been end-to-end verified in this environment.

## Required gates before public launch

1. Run `npm install` and `npm run ci` in a clean Node 20 and Node 22 environment.
2. Run local Monaco/LSP/debugging tests with the actual desired tools installed.
3. Test the isolated runner on a dedicated Linux VM with a real Docker daemon and adversarial project fixtures.
4. Deploy the Compose stack on a test domain; test account/session security, roles, concurrent revision conflicts, backups and restore.
5. Verify the deployment webhook independently; ensure it cannot be abused as an SSRF or arbitrary command endpoint.
6. Perform an external security review and measure real model-task pass rates and cost before marketing parity claims.

## v0.8 additions and exact verification gates

- Hosted preview and process APIs, private runner lifecycle manager, sandboxed browser frame and npm script controls are implemented. A real Docker image is **not** available in the packaging environment.
- The browser agent now requires optional approval for an actual test run after changes; it can use observed failures to drive bounded repair steps, and labels untested outcomes as unverified. This is not autonomous, durable background execution.
- Operator verification: `docs/REAL_E2E.md` and `npm run test:runner-e2e` on a dedicated Linux Docker VM. The model benchmark requires a separately configured real provider; no model pass rate is claimed here.

## v0.9 changes and validation details

- `docs/PREVIEW_ROUTING.md` specifies the fixed-port streaming and WebSocket bridge, real security boundaries, and why opaque-origin sandboxed iframe HMR remains unsupported.
- `test/preview-stream.test.cjs` exercises real Node HTTP and WebSocket framing through the bridge with Docker process execution simulated. This complements mocked runner arguments and hosted auth tests; it does **not** test a real Docker daemon.
- Local project checkpoints use `data/checkpoints` outside workspace files. Restoring source files requires explicit confirmation, refuses to overwrite a workspace with a live managed process, and preserves root-level `.git`, `.env*`, `.npmrc`, and `node_modules`. Nested generated folders are not fully managed; export a full ZIP and retain a separate Git remote for longer-lived backups.
- The browser agent creates a local checkpoint before a task where size limits permit, but the agent still requires a visible browser session, approvals, and an actual model. It is not a durable autonomous worker.
- Thirteen Node tests passed together with five fixture validations and the benchmark dry run. Real model benchmarking, actual Docker, hosted Postgres/Caddy integration, WebGPU and a full Chromium UI run remain unverified.
