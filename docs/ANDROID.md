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

This configuration compiled successfully, but native bridge isolation, sharing, file-picker handling, keyboard behavior and lifecycle recovery still require device/emulator testing. Browser tests alone do not establish Android runtime safety or usability.

## Release

This is a debug build, signed with a development key, not a store-ready release. Keep release keystores and passwords outside Git. A release needs stable signing, device tests, icons/splash polish, privacy documentation, accessibility review, target-SDK review, and store compliance checks. Store distribution may have fees; direct APK distribution does not require a paid store account.

## Validation recorded for this development milestone

The local debug Gradle build completed, APK signature verification succeeded, and the APK archive contains the required IDE, Monaco and project-library assets. Node 22 CI passed: 14 Pages checks, 39 integration/configuration tests, five intentional red fixture baselines and evaluation dry run. Three actual Chromium HTTP workflows passed: the main IDE smoke; Monaco/completion and storage recovery; and approved local Node execution with a real failing assertion followed by one passing test after a manual source correction. The fixture validator also passed under Node 24 after explicitly selecting TAP. Native sharing and Android runtime behavior were not exercised on a device or emulator.
