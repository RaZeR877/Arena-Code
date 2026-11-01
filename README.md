# Vynqode 0.18 development test APK

Source: `9f076e2ed559703b729ef0cf262295f3709d2eb5` on `feat/android-complete-workflow`. Changes remain local; nothing was pushed or published.

## New behavior
- Real ESM/TypeScript/JSX/React web builds using bundled esbuild WASM.
- Explicit public npm production-dependency installation, archive integrity and tar safety checks, persistent locks/cache; package scripts never execute.
- Live rebuilds, source diagnostics, preview console, checkpointed templates, standalone static ZIP export.
- Bundled Python 3.14.2 via Pyodide: project modules/input/assertions, opaque-origin sandbox, private result channel, stop/timeout and temporary runtime files.

## Validation
Clean Node 22 install; 53 Node tests; 15 Pages checks; ten existing Chromium workflows plus the real npm/esbuild/Pyodide workflow; eight native JVM tests explicitly rerun; debug app/instrumentation APK assemblies; zero npm audit advisories. Actual React package installation and Python execution were exercised. Negative integrity responses were mocked; no AI provider was evaluated.

APK signature, package, version and identity continuity from the 0.17 debug APK were verified. All 142 bundled files exactly match the built web assets (the website-only .nojekyll marker is excluded). Version code: 5. Package: dev.vynqode.ide. This is a debug test APK. Physical-device/WebView tests and current native instrumentation remain unfinished; compilation does not establish those results.

## Phone use
Install as an update to the prior debug test app without clearing its data. Keep project ZIP backups. Editor menu → Web builds & packages → React template → Install web dependencies → Build & Preview. TypeScript needs no dependency download. Run Python offers a template and input field. Full usage/limits: docs/WEB_RUNTIME.md in the source repository.

## Remaining
Full Android Node/PTY/debugging and native npm scripts; large/binary workspaces; one shared folder/Git/runtime filesystem; runtime secrets; cloud hosting/accounts/sync/collaboration; physical Android validation; real-model solving evaluation. Browser builds are not a server runtime or framework HMR. Python has no independent WASM memory quota, OS shell, socket server, pip or persisted generated files.
