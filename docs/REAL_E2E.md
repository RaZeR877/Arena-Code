# Arena Code 0.9 — Real isolated runner, streamed previews and agent verification

This release implements the **code path** for a self-hosted IDE → project files → authenticated runner → disposable test container → disposable preview container → authenticated browser preview. It is **not** a provisioned cloud VM or a guarantee of a secure multi-tenant execution platform.

## Requirements

- Dedicated Linux VM that you control, with a supported Docker Engine and Compose plugin. The Docker daemon must run on the VM (no Docker host is available in the release-builder environment).
- Disk space for images and preview snapshots; enough RAM for Node, Postgres, and several short-lived containers (a small 2 GB VM is not a realistic concurrent production host).
- A DNS name + open ports 80/443 for public HTTPS, or a private reverse proxy for your own testing.
- Node 20+ for local CLI evaluation. `AI_API_KEY` and a configured real `AI_MODELS` entry for **model-assisted repair**. Without these the app clearly rejects real cloud AI calls. Browser-local WebLLM remains subject to WebGPU and device support.

## Deploy on a dedicated VM

1. Extract the repository, `cd arena-code` and copy `.env.hosted.example` to `.env`. Generate two unique, strong random values for `POSTGRES_PASSWORD` and `ARENA_RUNNER_TOKEN` (for instance `openssl rand -hex 32`). Do **not** share them in chat or commit `.env`.
2. Configure `ARENA_DOMAIN` with a domain pointed at that VM. Keep the runner's Docker socket and internal ports off public networks; this runner is effectively host-root-capable. Ideally put the runner on a VM used only for Arena execution, and never use it to host sensitive workloads.
3. Pre-pull the execution images on the **Docker host**: `docker pull node:22-alpine` and `docker pull python:3.12-slim`.
4. Run `docker compose --env-file .env -f deploy/compose.yaml up --build -d` from the repo root.
5. Check the status with `docker compose --env-file .env -f deploy/compose.yaml ps`, then open `https://YOUR_DOMAIN`. Register/sign in, import a Node project and run its tests using **Run tests**.
6. For previews, your project must have a `dev`, `start`, or `preview` npm script, serve HTTP on `HOST=127.0.0.1` and an allowed `PORT` (3000, 4173, 5173, 8000, 8080), and not require internet access at runtime. Use **Start isolated app** and **Show in preview**. Only the private runner may talk to Docker. The browser only talks to the authenticated Arena app.

### Test the ACTUAL Docker daemon (not a fake command)

After Compose is running, execute the verifier **inside the private runner container**, where `ARENA_RUNNER_TOKEN` is already available. This does not expose the private runner port or print the token:

```sh
docker compose --env-file .env -f deploy/compose.yaml exec -T \
  -e ARENA_RUNNER_URL=http://127.0.0.1:4311 \
  runner node scripts/verify-runner-e2e.cjs
```

If you run a standalone runner outside Compose, use `ARENA_RUNNER_URL=http://127.0.0.1:4311 ARENA_RUNNER_TOKEN=... npm run test:runner-e2e` **only on the trusted runner VM**. Never publish the runner port to the Internet.

The verifier constructs a deliberately failing Node project, checks that the original test fails **in Docker**, changes the source, verifies that the test passes, launches an isolated preview, fetches the real HTTP page through the authenticated runner, streams a 1 MiB JavaScript asset, upgrades a WebSocket, and stops the preview. A failed assertion exits nonzero. No paid AI service is needed for this **deterministic execution** gate.

### Model-assisted repair gate

After configuring a real `AI_API_KEY` and a model in `AI_MODELS`, open a project with `npm test` and use the coding agent. It asks for confirmation before each file edit and before test execution. When a model claims a task is finished after edits, the agent requests a verification run if a `test` script is defined; on failure, it supplies the observed error to the model and allows a bounded attempt to repair it (at most three failed verifications and 24 actions). Declined tests or missing tests are explicitly labeled **UNVERIFIED**. The browser session must remain open; tasks are not yet durably resumable.

For a scored evaluation on five immutable test fixtures using a real model, the **local** codebase supports `ARENA_EXECUTION_BACKEND=docker npm start` plus `npm run eval -- --model YOUR_CONFIGURED_MODEL`. Capture the generated `evaluation/results/latest.json`; report a genuine pass rate rather than the dry-run fixture count. Model evaluation on hosted mode is not yet automated.

## Current preview security and compatibility boundaries

- Docker preview containers have no published host port, `--network=none`, a read-only root/workspace, dropped Linux capabilities, no-new-privileges, CPU/memory/PID bounds and a fixed 15-minute default TTL. Files are isolated from the main app process.
- HTML/JS/CSS is proxied via a **same-origin, authenticated API path** and rendered in a sandboxed iframe. No unsandboxed same-origin iframe is enabled. HTTP `GET/HEAD` is supported up to **16 MiB** per response; an authenticated WebSocket protocol bridge is implemented. The sandboxed browser iframe may block HMR because of the opaque-origin security boundary.
- The runner performs a bounded `docker exec` HTTP fetch inside the preview container for each asset. This is a correctness-first implementation, **not** a production-grade high-throughput reverse proxy. Streaming is implemented through a bounded in-container Node bridge, but large bundles over 16 MiB, arbitrary app-origin absolute URLs and unrestricted browser HMR are still unsupported. Consult `docs/PREVIEW_ROUTING.md`.
- Preview scripts run **user code**. Container restrictions reduce risk but are not a hard security boundary against kernel/daemon vulnerabilities. The runner has access to `/var/run/docker.sock` and is effectively host-root-capable. Isolate the entire runner on a disposable VM and get an independent security review before serving untrusted users.
- Only already installed dependencies can be used at runtime. Use the separate container dependency install action first. The preview itself cannot download packages.
- Starting a preview snapshots project files. You must **stop and restart** to see changes to files stored in PostgreSQL.
- A real Docker daemon, public DNS/TLS, database-backed auth, GPU inference, and real provider-task pass rate were **not** exercised in the packaging environment, and must be validated by the operator.

## Troubleshooting

- `503` at Start isolated app: confirm Docker Engine works, the Node image is pulled, the app's `ARENA_RUNNER_URL` and token are correct, and the runner service is healthy.
- `502` while viewing a preview: server probably hasn't started, listens on the wrong port/host, or is crashing. Try an npm `start` script that uses `process.env.PORT` and `process.env.HOST`.
- `429`: preview capacity or daily execution quota reached; raise limits only after observing resource use.
- Missing CSS/JS or HMR errors: check relative asset URLs, generated file sizes, and framework dev-server assumptions. Hosted previews require a prefixed asset base and do not rewrite arbitrary root-relative URLs. A WebSocket bridge exists but browser sandbox policies prevent general HMR; see `docs/PREVIEW_ROUTING.md`.
- Production public launch: add abuse protections, strict tenant isolation, disk quotas, complete CSRF/CSP review, availability monitoring, backup restore drills, and threat modeling. This is a development milestone, not an audited SaaS platform.
