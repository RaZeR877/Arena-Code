# Arena Code architecture and security boundaries

## Components

```text
Browser UI
  ├── Chat/model selector ──────> local model or optional server-side provider
  ├── Monaco editor ────────────> built-in JS/TS services + optional LSP WebSocket
  ├── Project workspace ───────> local filesystem (local mode)
  │                              or PostgreSQL files/history (hosted mode)
  └── Agent action approvals ──> fixed APIs for read/search/patch/check/run

Hosted app ── authenticated archive request ──> private runner
                                                ├── disposable npm/Python jobs
                                                └── isolated LSP image sessions

Hosted app ── deployment archive/webhook ──> admin-controlled deployment adapter
Caddy HTTPS reverse proxy ──> hosted app
PostgreSQL (private network) ──> accounts, sessions, workspace members, files/history, deployments
```

## Trust boundaries

1. **Browser:** UI state is untrusted. The provider key is never included in the browser bundle or status response. The editor's LSP bridge never accepts an executable name or arbitrary server command from browser input.
2. **Local server:** binds to loopback by default, checks origins, validates request bodies/paths, limits archive sizes, and provides a bounded API surface. Local mode has no login and must not be exposed publicly.
3. **Hosted app:** session tokens are high entropy; only their hashes are persisted. Passwords use a salted scrypt hash. Workspace membership and roles are checked on requests; writes use revision checks/row locks to prevent silent concurrent overwrite. This is a starting security architecture, not an audited auth system: no email verification, password reset, MFA, or full abuse/credential-stuffing defenses are supplied.
4. **Archive/workspace storage:** paths are relative and normalized; reserved secret/dependency directories are filtered; malformed ZIPs, traversal, duplicate entries and archive limits are checked. Project files are data and must not be treated as trusted merely because stored in the DB.
5. **Preview:** static HTML preview uses an opaque-origin iframe sandbox. It still allows script/form/download behaviors and outbound requests. The hosted development-server/preview route is intentionally unavailable until an isolated preview worker and port router are deployed.
6. **Execution runner:** receives authenticated bounded ZIPs and executes only fixed actions. Install steps can access package registries in a disposable container; build/test steps run without network. Containers request dropped capabilities, no-new-privileges, read-only root, bounded PIDs, memory/CPU, tmpfs and timeouts. This lowers risk but is not a security proof. The fake-Docker tests validate options only, not container kernel isolation.
7. **Docker socket:** the runner needs access to `/var/run/docker.sock`, which is effectively host-root-equivalent. Keep it on a dedicated Linux VM/private network; do not publish its port and don't place sensitive workloads on the same host. Use separate runner nodes and stronger VM/microVM isolation before accepting public untrusted code.
8. **LSP:** only administrator-configured language images and fixed commands are accepted. Hosted LSP containers have network disabled and a read-only source mount. LSP session IDs are random, requests are allowlisted, payload/output bounds and idle timeouts are enforced, and the app authenticates/authorizes workspace read access before creating a session.
9. **Deployment webhook:** only the admin can configure the endpoint/secret and only workspace owners can submit deployment requests. The external adapter must authenticate requests, validate archive paths/size, enforce time and resource limits, and keep provider credentials outside workspaces. Arena does not itself authenticate to a provider such as Vercel or Netlify.
10. **External model provider:** when cloud AI is selected, prompts and project context are transmitted to the configured provider. Review the provider's data policy and terms before sending confidential code. Local/browser inference consumes local hardware resources and may be less capable.

## Fixed execution actions

The runner exposes only predefined operations: npm dependency installation/build/test, Python binary-wheel install/unittest, JavaScript/Python syntax checks, and optional language-server sessions. It does not expose a general shell endpoint. `npm install` runs in an isolated disposable network-enabled container with lifecycle scripts disabled; tests/builds run offline with dependency caches mounted read-only. Python installation accepts binary wheels only to avoid executing source distributions during install.

Local host mode is less isolated. `npm test`, local development scripts and Node Inspector run under the user account. The debugger grants control of the debugged process. Only use these local actions for trusted code.

## Operational responsibilities

Hosted operators need TLS/DNS, database backups and restore tests, dependency/image updates, strong environment secrets, account abuse protection, logs/metrics/alerts, quotas and cost controls, and a security response plan. The self-hosted stack does not supply managed cloud operation or guaranteed zero-cost inference.
