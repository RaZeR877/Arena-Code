# Editor, language servers, and debugging

Arena Code uses Monaco Editor when npm dependencies are installed. The postinstall script copies the Monaco runtime to `public/vendor/monaco` so production deployments do not need to fetch editor assets from a CDN. An unpacked ZIP without installed npm dependencies can use the CDN fallback; for offline/restricted networks, run `npm install` first and verify `public/vendor/monaco/vs/loader.js` exists.

## Local mode

The built-in JavaScript/TypeScript language service provides editor diagnostics and completions without another process. For Python, Rust, Go, Java, or C#, configure a language server as an administrator in the environment used to launch Arena:

```json
ARENA_LSP_SERVERS={"python":{"command":"pylsp","args":["--stdio"]},"typescript":{"command":"typescript-language-server","args":["--stdio"]}}
```

This is a JSON environment variable, not a file. On PowerShell, quoting rules can make JSON environment values cumbersome; set it through a `.env` loader or process manager if needed. Install the commands yourself (`python -m pip install python-lsp-server`; `npm install --global typescript typescript-language-server`). Arena only starts the fixed server definitions chosen by the administrator; browser requests cannot supply an executable or shell command. A language server runs under the local Arena OS user and should only be enabled for trusted local projects. Restart Arena after changing the environment.

## Hosted mode

Hosted language servers are deliberately separate, network-isolated containers. Only `python` and `typescript` are enabled by the runner implementation today. Build the two images on the same Linux host/Docker daemon that the private runner's Docker socket controls:

```sh
docker build -f runner/lsp/python.Dockerfile -t arena-lsp-python:latest .
docker build -f runner/lsp/typescript.Dockerfile -t arena-lsp-typescript:latest .
```

Set these values in the server environment (for Docker Compose, copy the example values into `.env`):

```dotenv
ARENA_LSP_LANGUAGES=python,typescript
ARENA_LSP_IMAGES='{"python":"arena-lsp-python:latest","typescript":"arena-lsp-typescript:latest"}'
ARENA_LSP_MAX_SESSIONS=8
```

`ARENA_LSP_LANGUAGES` belongs to the app service. `ARENA_LSP_IMAGES` and `ARENA_LSP_MAX_SESSIONS` belong to the runner service. Recreate both services after changing them. The workspace snapshot is mounted read-only into an LSP container; runtime networking is disabled, Linux capabilities are dropped, resource limits are set, and idle sessions expire. The TypeScript image can mount a matching npm dependency cache read-only when one was previously created by the isolated dependency installer.

The runner requires Docker socket access, which is effectively host-root access. Keep it on a dedicated Linux VM/private network, do not publish port 4311, protect its bearer token, and keep the images administrator-controlled. Image builds themselves require downloading package content and should happen on an admin-controlled build machine. Real Docker images and end-to-end language-server traffic must be tested on the deployment host before enabling this feature for users.

## Debugging

For local Node.js files (`.js`, `.cjs`, `.mjs`), choose **Debug Node file**. Arena starts Node Inspector bound to loopback and displays its DevTools link in the process output panel. The inspector can evaluate code in the debugged process, so this feature is local-only and must only be used with trusted projects. The app does not yet provide a native cross-language debug adapter, hosted remote debugging, or a full VS Code debug console.
