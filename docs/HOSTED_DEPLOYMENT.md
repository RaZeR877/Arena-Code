# Self-hosted Arena Code deployment

This is a self-hosting baseline, not a managed hosted service. You operate the VM, database, Docker daemon, domain, TLS, provider key, backups, costs, and incident response.

## Components

- **Caddy** terminates HTTPS for the configured domain.
- **Arena app** serves the UI and API, validates sessions/roles/revisions, and stores account/workspace/history/deployment records in PostgreSQL.
- **PostgreSQL** is on a private Compose network. Workspace edits use revisions and transaction locking to avoid silent last-writer-wins overwrites.
- **Isolated runner** receives an authenticated archive from the app and starts disposable Docker jobs for npm/Python install/build/test/syntax actions. It also brokers a limited allowlist of language-server methods into admin-built LSP images.
- **Deployment adapter** is an administrator-provided webhook that receives a project archive and deployment metadata. It must authenticate the caller, verify input limits, unpack safely, and call a provider such as Vercel/Netlify using credentials stored in the adapter, not in project files.

## Setup

1. Use a dedicated Linux VM with Docker Engine and Docker Compose, and point DNS for `ARENA_DOMAIN` to it.
2. Copy `.env.hosted.example` to `.env`. Generate unique random `POSTGRES_PASSWORD` and `ARENA_RUNNER_TOKEN` values (hex strings such as `openssl rand -hex 32` avoid URL-encoding problems in `DATABASE_URL`). Do not commit the real `.env`.
3. Review `deploy/compose.yaml`, especially the runner's Docker socket mount. A compromised runner can control the Docker host; use a dedicated VM and do not reuse it for sensitive workloads.
4. Start the stack from the repository root:

   ```sh
   docker compose --env-file .env -f deploy/compose.yaml up --build -d
   ```

5. Check `docker compose --env-file .env -f deploy/compose.yaml ps` and logs. Caddy requires public DNS and ports 80/443 to be reachable before it can issue TLS certificates.
6. Set `AI_API_KEY` and a supported `AI_BASE_URL`/`AI_MODELS` if you want server-side AI. Without an API key, chat clearly indicates demo mode; a local/browser model is not a hosted inference service.
7. Optional language servers: build images and set the app/runner environment values from `docs/LANGUAGE_SERVERS.md`.
8. Optional deployment: deploy a trusted adapter endpoint and set `ARENA_DEPLOY_WEBHOOK_URL` and `ARENA_DEPLOY_WEBHOOK_TOKEN`. Without it, deployment requests fail closed.
9. Make regular PostgreSQL backups, update base images and npm dependencies, rotate credentials, and watch CPU, memory, disk, request, and model-provider usage.

## Hosted capabilities and limitations

The source implements accounts, session cookies, sign-in/sign-up, database-backed workspaces, owner/editor/viewer roles, sharing, per-file history, optimistic workspace revisions, isolated build/test requests, optional isolated LSP sessions, and adapter-driven deployment tracking. Public registration can be disabled with `ARENA_ALLOW_SIGNUP=0`.

Still not a complete hosted IDE: no password-reset/email verification/MFA, no billing/quotas/usage ledger, no persistent PTY terminal, limited authenticated offline hosted previews (no HMR/WebSockets), no native debugger, no built-in Vercel/Netlify OAuth integration, no automatic backup/restore workflow, and no production security audit. The hosted `/process` route uses an authenticated private runner for short-lived, offline Docker previews; it does not run user code in the web app. Read `docs/REAL_E2E.md` for restrictions, deployment validation and the real-Docker test.

### Hosted previews

Hosted `Start isolated app` launches one short-lived Docker container per workspace. It does not expose a host port; the authenticated project preview proxy fetches small HTTP assets via `docker exec` within the container. Only scripts named `dev`, `start`, and `preview` can be launched. A preview is a point-in-time snapshot of the workspace and must be restarted to pick up changes. WebSockets/HMR, absolute-root asset URLs outside the preview path, and large assets are not supported. Configure `ARENA_PREVIEW_MAX_SESSIONS` and `ARENA_PREVIEW_TTL_MS`, then validate on your own real Docker host using `npm run test:runner-e2e`. Do **not** deploy the runner on a shared host.
