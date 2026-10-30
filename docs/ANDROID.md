# Vynqode Android development

Vynqode now includes a Capacitor Android project (`dev.vynqode.ide`). The app bundles the same focused IDE and Monaco assets as the web build. No paid backend, Play account or API subscription is required to build a debug APK.

## Build

Install Node 22, JDK 21 (including `javac`), and the Android SDK for API 35. Set `JAVA_HOME` and `ANDROID_HOME` to your local installations. Android Studio can install the SDK. Accept Android's SDK licenses using its standard setup flow.

```sh
npm ci
npm run ci
npm run android:debug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. Install on a test device using `adb install -r <path-to-apk>`. The manual **Build Android debug APK** GitHub Actions workflow builds and uploads the same artifact; it does not publish a store release.

`npm run android:open` opens Android Studio. After changing web assets, run `npm run android:sync`. No remote development-server URL is configured: assets load from the APK, using a local HTTPS origin. Gradle's wrapper distribution has its official SHA-256 pinned. Root npm dependencies have a committed lockfile.

## Capabilities and limits

- Browser-local project editing, syntax checks, sandboxed HTML preview, undo and project snapshots are bundled.
- Smart editor is an explicit toggle: bundled Monaco provides highlighting, find/replace, completion and language-worker diagnostics. The simple editor remains available on phones. Monaco itself does not run programs.
- Unsaved text is backed up after a short debounce and when the page is hidden. Recovery applies only when the saved base project is unchanged. Save and export remain necessary; clearing app data or uninstalling removes local work.
- **Projects** saves up to 25 named/time-stamped IndexedDB snapshots. Open switches to a snapshot; remove deletes only that snapshot. Export ZIPs for off-device backups.
- Native ZIP export writes to the app cache and opens Android's share sheet. Cache files are temporary, not durable backups. Choose a destination that retains the ZIP.
- Provider keys are never bundled or stored by Android. The existing provider connector requires the same-origin localhost Node service, which is not included in this app. Android does not gain cloud AI by silently forwarding keys. WebGPU/on-device inference depends on the device WebView and has not been verified.
- The **Tests** workflow is available when served by the local Node app, not inside the APK. It imports an approved snapshot and invokes the existing runner. Host execution runs trusted project scripts as the user's OS account. Saved execution copies remain in local server storage. Failed test output can populate a repair prompt; users still request and approve edits and rerun tests.
- There is no Android PTY terminal, Node runtime, native debugger, Git client or Docker daemon. These are unfinished integrations, not features supplied by Capacitor.

## Android boundaries

Preview documents remain opaque-origin sandboxed iframes. The activity removes JavaScriptInterface fallbacks (which otherwise expose methods to subframes), retaining the modern origin-scoped main-frame Capacitor message listener. Legacy WebViews fail closed for native operations. HTTP/cookie native interception is unused. File sharing is restricted to the app's export-cache directory. Cleartext/mixed content and arbitrary navigation allowlists are not enabled.

The API 35 native instrumentation workflow now passes editing/draft recovery, IndexedDB snapshots, bundled Monaco/language-worker completion, opaque-preview bridge isolation, native ZIP creation and share-sheet cancellation. This is an emulator result, not a full security audit or a physical-device/IME/file-picker compatibility matrix.

## Release

This is a debug build, signed with a development key, not a store-ready release. Keep release keystores and passwords outside Git. A release needs stable signing, device tests, icons/splash polish, privacy documentation, accessibility review, target-SDK review, and store compliance checks. Store distribution may have fees; direct APK distribution does not require a paid store account.

## Validation recorded for this development milestone

The local debug Gradle build completed, APK signature verification succeeded, and the APK archive contains the required IDE, Monaco and project-library assets. Node 22 CI passed: 14 Pages checks, 39 integration/configuration tests, five intentional red fixture baselines and evaluation dry run. Three actual Chromium HTTP workflows passed: the main IDE smoke; Monaco/completion and storage recovery; and approved local Node execution with a real failing assertion followed by one passing test after a manual source correction. The fixture validator also passed under Node 24 after explicitly selecting TAP. Native checks were unrun at that initial foundation milestone; the completed API 35 run below supersedes that limitation.

## Runtime and repair follow-up

The focused localhost IDE now has **Tools** with a real PTY terminal and an integrated Node Inspector debugger (breakpoint line, pause/resume, stepping, stack and locals). They use an approved execution copy. Import its files explicitly to change the browser project; import is rejected if the browser project diverged. Sessions are local-only, same-origin, limited to three, capped at 256 KiB output each and expired after 15 minutes idle. Terminal child environments exclude the server's API credentials. This remains trusted host execution, not sandboxing. PTY support is an optional native dependency; hosts without its compiler/prebuild can still use the rest of the IDE.

**AI repair loop** runs tests and proposes at most two corrections. Each patch requires explicit approval, protected tests/package.json cannot be edited, a recovery snapshot is saved first, and a cancelled in-flight model result is discarded. Model calls can be billed by the selected provider. Tests here use mocked model responses and actual Node execution; they are not real-model quality benchmarks.

Explorer and assistant widths support pointer/keyboard resizing on desktop with clamped saved preferences. Separators are hidden on mobile. Project import/export actions are also available inside Projects on phones.

Run `npm run android:device-test` with a ready Android device/emulator and current WebView. The app-specific instrumentation tests editing/draft recovery, IndexedDB snapshots, preview bridge isolation, actual native ZIP creation and share-sheet cancellation. The manual **Android native workflow tests** action supplies a hardware-accelerated API 35 emulator once merged. Compilation is distinct from running this test; consult the recorded current-session result before claiming native behavior works.

See [RELEASE_SIGNING.md](RELEASE_SIGNING.md) for the newly configured signing identity and signed APK/AAB builds. Signing credentials remain outside Git.


## Completed native gate — 2026-10-30

[API 35 native workflow succeeded](https://github.com/RaZeR877/Arena-Code/actions/runs/41045231521) for the corrected instrumentation on commit 865b1ee. The workflow requires nonzero successful JUnit results, so compilation or an empty run cannot pass this gate. The test exercises actual Android WebView/Capacitor storage and export plugins, including cancellation and preview bridge separation. A reload-readiness race in the test was corrected by waiting for a new document, without removing assertions. Local software emulation produced process-start ANRs; the recorded passing gate uses KVM on a public Ubuntu 24.04 runner.

The release APK and AAB signatures were verified. Signing credentials were scanned against tracked files and both archives and were absent. The signing identity and its private backup remain outside the checkout. Store publication, physical-device coverage, and real-model benchmarks are not claimed.
