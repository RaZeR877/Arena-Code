Vynqode IDE 0.15.0 RC1 is a signed Android release candidate with the focused editor and project workflow.

### Downloads
- **APK:** install directly on Android. A current Android System WebView/Chrome (120+) is required.
- **AAB:** signed Android app bundle for future distribution work; this release does not publish to an app store.
- SHA-256 checksum files accompany both downloads.

### Included
- Bundled Monaco editor with completion and language diagnostics; simple-editor fallback.
- Project snapshots, unsaved-draft recovery, ZIP import/export and sandboxed HTML preview.
- Reviewed AI line diffs and a bounded test/repair workflow.
- Localhost Node edition: interactive PTY terminal, integrated Node debugger and resizable panels.

Android does not bundle a Node/Docker runtime or the desktop terminal/debugger. Optional provider APIs use the localhost Node edition. No paid provider is required by default.

### Validation
- 40 Node tests; the 14-test Pages subset also passed.
- Five real Chromium workflows passed; repair inference was mocked while actual Node assertions ran.
- Native API 35 workflow passed: https://github.com/RaZeR877/Arena-Code/actions/runs/41045231521
- APK/AAB signatures and packaged assets verified; signing credentials excluded.

Physical-device coverage, real-model benchmark scores and store readiness are not claimed. Export projects before replacing a debug build: Android may require uninstalling a differently signed debug installation, which removes its data.

Source: e4e255d3cf4d51da353d5e1650d05d0cf848e004.
