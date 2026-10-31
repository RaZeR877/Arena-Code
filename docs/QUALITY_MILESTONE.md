# Quality follow-up — 0.16 development draft

This unpublished follow-up covers Git, editing, agent context/evaluation, an
optional Android computer companion and release gates. It preserves the focused
IDE, project data keys and ₹0 default. No cloud model, paid service or new
signing identity is required. Source version is `0.16.0-dev`; Android versionCode
is 3. The previously published RC remains a separate release.

## Git with recovery

**Projects → Git** now includes branch creation/switching, editor-to-commit
diffs, merge, pull, conflict resolution and abort. Commit editor files explicitly;
the app-local Git copy and the active editor remain separate until you open or
commit that copy. The device folder's `.git` remains separate too.

Merges require a clean Git copy and create a named recovery branch before
changing it. Text conflicts are shown in **Open working copy**. Resolve the
markers, review the source and commit to create a merge with both parent commits.
Unresolved markers block commit; a pending merge blocks branch changes and push.
**Abort merge** restores its original branch state. Unsupported/binary conflicts
abort rather than pretending to resolve them. Complex recursive merge strategies
and arbitrary Git hosts remain unsupported.

A real HTTP Git test exposed a persistence bug: LightningFS deferred saving its
filesystem metadata, so an immediate reload could lose recently reported work.
Successful mutations now await a flush. Pending merge ancestry is also journalled
inside `.git/vynqode-merge.json`; stale app metadata cannot silently turn a merge
resolution into an unrelated one-parent commit. Failed clones wipe their new
working copy where storage permits. A failed fetch preserves the existing HEAD.

GitHub HTTPS uses the existing native-only transport. Its destination, method and
header policy now lives in `GitTransport.java`, tested without Android. Neither
API tokens nor Authorization headers enter the page. Push still requires page
and native confirmation. Tests of the Git protocol use a disposable local HTTP
remote through an explicitly mocked native delegate; they do not establish that
real Android/GitHub transfers work.

## Editing and context

- **Find → Review replacement** previews literal multi-file changes. Apply is
  explicit, rejects stale project sessions and changed input, and retains one
  Undo for the whole edit. Size preflight prevents large expansion from being
  constructed before checking the workspace budget. This is a manual edit;
  review syntax/runtime effects separately.
- **Settings** persists font size and wrapping. Formatting is explicit; JSON also
  works in Simple editor. **Project diagnostics** lists syntax errors and loaded
  smart-editor diagnostics and navigates to source positions. Monaco now checks
  JavaScript types across relative project modules. The phone accessory includes
  explicit completion, and short viewports retain the footer. These are Chromium
  results; physical Android IME/touch behavior remains a separate check.
- **Project context** shows file/language/test/script inventory and allows up to
  five pinned files. Pins receive complete inclusion or fail before inference
  when over budget. Pins reset when projects switch. A model's explicit missing
  context response stops rather than automatically spending another request.
  Task history records latency/request counts; billed cost remains unknown.

## Actual functional AI checks

**Test selected AI · 3 JS tasks** runs an opt-in evaluation with the selected
engine. It warns about up to six model requests. Each task must fail its immutable
baseline first; candidate changes are syntax checked, cannot modify the contract,
and execute inside the bounded QuickJS VM. User project files are unchanged.
The downloaded JSON reports results, assertion counts, latency and available
request counts. Token usage and billed cost are not invented.

The tasks cover numeric behavior, a two-file implementation and configuration
parsing/immutability. They are small synchronous JavaScript tasks, not SWE-bench
or proof of general model quality. Development tests use an explicit fixture
model with real red/green QuickJS execution. No real model quality score has been
measured in this environment, which has no ready provider credentials.

## Optional USB computer companion

Android **Tools** offers explicit project ZIP export/import and a fixed local
companion launch. On a trusted USB-connected computer running Vynqode with Node
22, use:

```sh
npm ci
npm start
adb reverse tcp:3000 tcp:3000
```

Then open the companion from the app. It opens `http://127.0.0.1:3000` in the
phone browser, separately from the APK. Import the exported ZIP there, run Node,
terminal/debugger workflows on the computer, export the execution ZIP and import
it back in the app. There is no automatic sync and credentials remain separate.
Remove forwarding with `adb reverse --remove tcp:3000` when finished.

This keeps the existing same-origin/loopback controls; it does not bind the server
to the LAN, add permissive CORS, forward keys or grant arbitrary remote terminal
access. The computer and USB connection must remain available. Android still
contains no embedded Node/npm/PTY runtime. Desktop Node execution is tested; a
physical USB/browser round trip has not been exercised here.

## Release and native gates

`verify-android-release.py` verifies signatures, package/version metadata,
checksums, required bundled assets, absent development-server URL and public
certificate continuity against `android/release-certificate.sha256`. The pinned
fingerprint came from the existing RC; private signing material is untouched.
With a previous APK it also requires an increased versionCode. Debug artifacts
are rejected as releases; `--allow-debug` produces development-only reports.

The signed-build workflow now depends on the browser workflows and accelerated native job at the same
source revision and uploads checksum sidecars/verification JSON. Its result gate
requires at least three executed tests and both WebView and device-storage test
classes. Empty, skipped or unrelated successful reports cannot satisfy that
coverage gate. These workflow changes are local; no Actions run was dispatched.

Native configuration dialogs now scroll and resize for the keyboard, the activity
requests keyboard resize, and instrumentation includes background/recreation
recovery. Invalid credential/header characters fail before networking without
returning the credential in an exception message.

## Recorded validation — 2026-10-31

- Clean Node 22 install, Pages build and CI: 14 Pages checks and 48 Node tests;
  five intentional red fixture baselines and evaluation dry run.
- Nine actual Chromium workflows: editor/preview/ZIP; Monaco/recovery; approved
  Node runner; PTY/debugger; bounded repair; Android workflow mechanism; Git
  branches/diffs/merge recovery; actual Git HTTP; replacement/settings/formatting/
  cross-file diagnostics/context and functional-evaluation mechanism.
- Dependency audit: zero advisories after a targeted build-tool override of rimraf's glob to 14.0.2 (including patched minimatch). This retains the existing Capacitor CLI and declared Node 20 support; actual glob deletion/abort compatibility, clean install, sync and build passed on Node 22.
- Eight native JVM tests, including real loopback HTTP bounds/redirect rejection,
  provider fixtures, safe paths, Git policy and credential-error secrecy.
- Debug app and instrumentation APK assembly; actual artifact-verifier acceptance
  of the debug upgrade's certificate/version continuity and rejection of debug
  release classification, bad checksum, wrong signer and non-increasing version.
- Native instrumentation is **not passed**. Software API 35 attempts did not reach
  usable readiness. The separate API 30 attempt executed zero tests: installation
  failed because the package service was unavailable. There is no `/dev/kvm`.

Before release, execute the new Keystore/SAF/WebView tests on accelerated API 35,
then verify real folder-provider revocation/partial saves, physical keyboard/IME,
rotation/background recovery, USB transfer and installed signed upgrades. Actual
provider inference and Android/GitHub transfers need explicit test accounts and
consent. Store distribution and broad language/framework runtime support remain
outside this verified draft. No push, deployment, release or environment
publication has been performed.
