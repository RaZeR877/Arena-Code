# Hosted preview routing (0.9.0)

The runner provides a **private preview-container bridge**, not a general-purpose public reverse proxy. It does not publish a Docker host port and the runner token must never be exposed to browsers.

## Supported paths

1. The browser requests `GET /api/projects/<workspace-id>/preview/path/to/asset` on the authenticated Arena app.
2. The app checks the session, project membership, active preview and allowed port, then streams the body from its dedicated runner.
3. The runner performs a bounded `docker exec` of the fixed `node -e` HTTP probe **inside** the container's `--network=none` namespace and streams raw bytes through the app to the user. Neither the app nor the runner can fetch arbitrary external URLs through the preview endpoints.
4. The app and runner can also forward authenticated WebSocket upgrades to a preview service running at an allowed loopback port. Only upgrade headers and frames are forwarded. Test with `scripts/verify-runner-e2e.cjs` on a real Docker VM.

Allowed loopback ports: **3000, 4173, 5173, 8000, 8080**. The project must bind to `127.0.0.1` and use `process.env.PORT`; Arena passes both `HOST` and `PORT`. For framework-specific tooling, Arena also sets `ARENA_PREVIEW_BASE` to `/api/projects/<workspace-id>/preview/`. Choose the port when starting a hosted app; request a different allowed port with `?__arena_port=5173` only if a process already listens there. The preview has a 15-minute default TTL; HTTP responses are capped at 16 MiB and upgrades at 32 MiB total in each direction. A restarted preview takes a fresh read-only snapshot; edits in the editor are **not** automatically applied to the running container.

## HMR and absolute paths: important limitations

A working **WebSocket transport is not equivalent to working Vite/Next.js HMR**. Frameworks may generate URLs like `/@vite/client` or `/assets/main.js` outside Arena's `/api/projects/<id>/preview/` prefix. Configure the framework's asset base path to use `ARENA_PREVIEW_BASE`, and ensure its HMR connection URL also uses the Arena preview path. There is no transparent arbitrary `/` route rewrite, no generic browser terminal/PTY, and no unrestricted public port forwarding.

**Security:** Arena previews run in sandboxed iframes and receive a `Content-Security-Policy: sandbox ...` header, so their JavaScript has an opaque origin. Browser WebSocket handshakes may therefore have `Origin: null`, which Arena intentionally denies. Removing `sandbox`, allowing `allow-same-origin` together with scripts on this same application origin, or blindly accepting `Origin: null` would expose signed-in users to untrusted project JavaScript. A future release must use a separate, isolated preview origin and scoped preview credentials before promising unrestricted browser HMR. The WebSocket protocol is tested, but **embedded browser HMR is not claimed complete**.

## Operations and safety

- Runner Docker socket control is host-root-equivalent; place the runner on a **dedicated disposable VM**, not the app/database host containing sensitive data. Current Compose example is a development starting point, not hardened multi-tenant infrastructure.
- Use the real runner gate: `docker compose --env-file .env -f deploy/compose.yaml exec -T -e ARENA_RUNNER_URL=http://127.0.0.1:4311 runner node scripts/verify-runner-e2e.cjs`.
- The verifier executes red/green npm tests, an HTTP page, a 1 MiB response, and a WebSocket handshake/frame via the private runner; it cleans up the preview even after failure. It cannot validate arbitrary framework HMR by itself.
- The `node --test test/*.test.cjs` suite also validates private-runner request auth, same-workspace access, a 1.25 MiB streamed asset, port allowlists, and cross-origin WS rejection using test doubles. `test/preview-stream.test.cjs` exercises the **actual nested Node bridge protocol** without Docker.
- Require a real browser, real Docker, a dedicated runner VM, an independent penetration test, and production observation before exposing this system to untrusted users.
