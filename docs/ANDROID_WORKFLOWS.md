# Android workflow draft

See [QUALITY_MILESTONE.md](QUALITY_MILESTONE.md) for the latest quality/0.16 development follow-up. This draft extends the existing Vynqode IDE. It is local, unpublished work on
`feat/android-complete-workflow`, separate from the previously published RC.
The default budget remains ₹0. No paid model, backend or store account is required.

## Use the workflows

- **Connect AI → API providers → Configure securely on this device:** enter a key
  in the native Android dialog. It stays outside page JavaScript, encrypted with
  Android Keystore. Configure allowed model IDs, then explicitly select the API
  before sending context. Remove saved credentials from the same panel. No model
  request occurs just by configuring it. Cloud requests may incur provider charges.
- **Projects → Open device folder:** grant access using Android's folder picker.
  Edit text files, then select **Save to device folder** and approve the native
  confirmation. Reopen after restarting the app or switching projects. A folder
  link cannot save a different project session. Existing external edits abort
  preflight with no writes. A change during writing can cause a partial save;
  the UI reports it and requires reopening rather than claiming atomic success.
- **Projects → Git:** initialize a real app-local working copy, supply a commit
  author/message, and commit editor files. Git objects persist in IndexedDB.
  Opening the working copy explicitly replaces the editor project after saving
  a snapshot. Git status describes this working copy; editor changes enter it
  when committed. Android's native HTTPS transport supports GitHub clone/push.
  Public clones need no token. Configure/remove an optional GitHub token using
  the native credential controls. Push requires confirmation in the page and in
  Android and can publish code. There is no automatic push.
- **Search:** `Ctrl/Cmd+Shift+F`, the search rail, or the phone's **Find** control
  searches literal project text and selects the matching source position.
  Close file tabs without deleting source; keyboard users can press Delete on
  a tab. Phone editing adds Tab and punctuation controls.
- **Projects → Agent history:** inspect requests, context and syntax evidence,
  open a saved task checkpoint, or resume a pending edit review. Reviews require
  matching source and fresh approval. Interrupted generation can be retried by
  copying its request; model computation and old execution approval do not resume.
- **Tests → Isolated JavaScript:** select a `.js`/`.cjs` entry, run it or run its
  assertions, inspect output, and stop execution. The bounded repair loop can use
  this runtime and still requires approval for each patch. Tests/package.json
  remain protected. Browser-local AI availability still depends on WebGPU;
  Ollama requires a separate service on the device's loopback, not a computer's.

Example synchronous QuickJS test:

```js
const {test} = require('node:test');
const assert = require('node:assert/strict');
test('sum', () => assert.equal(require('./sum')(2, 3), 5));
```

## Boundaries and recovery

The workspace remains limited to 100 text files, 400 KiB/file and 3 MiB total.
Browser storage quota can impose a lower practical limit. Keep external ZIP
backups; clearing app data/uninstalling removes local working copies and keys.
Keystore credentials deliberately do not transfer through Android backups.

Folder loading excludes secret/generated paths, binary/non-UTF-8 files and files
above the file limit. Excluded files and existing `.git` metadata are untouched.
Folder traversal is bounded; an oversized project fails instead of importing a
truncated editable project. Native saving verifies written bytes, keeps the last
five private recovery records, and saves a browser snapshot before the operation.
Those records are under app-private `files/device-recovery`; restore a snapshot
or ZIP through the UI to recover a project. Multi-file SAF writes are not atomic.
Device-folder Git metadata is separate from app-local Git; there is no SAF `.git`
bridge, arbitrary remote host support, arbitrary merge strategies. Branch creation/switching, editor diffs, pull and text-conflict resolution are now available in app-local Git; see [the quality follow-up](QUALITY_MILESTONE.md).

Git transport caps responses/uploads, object counts, individual inflated objects
and expanded pack totals before checkout. Large repositories may be rejected even
if their editable text would fit. Existing excluded tracked binaries are retained
when copying editor text back, unless the user explicitly introduces a text file
at that same path. Clone/push transport needs a native runtime validation gate.

QuickJS is bundled WASM inside a disposable Worker. Project code runs inside the
VM, with no host DOM, fetch, storage, native bridge or filesystem functions. The
VM has a 32 MiB memory limit, 512 KiB stack and approximately two seconds of
execution time; the parent terminates a worker after 15 seconds including load.
It supports project-relative CommonJS/JSON and a limited synchronous assert/test
shim. It does not implement Node/npm, ES module loading, asynchronous tests,
Python, a native terminal, a debugger, or arbitrary framework builds. A test
verdict requires at least one assertion. A program run is labelled separately.
These limits and checks are not a formal sandbox/security certification.

Snapshot database schema v2 preserves v1 records and adds task/repository stores.
There are 25 snapshots and 30 task records. Unfinished reviews are not silently
evicted. Completed task records can be rotated; recovery snapshots remain until
explicitly removed. The static relative-dependency index ranks relevant context;
it is not a full language-server or semantic project index.

## Validation of this draft

Executed locally on Node 22 and real Chromium:

| Check | Result |
| --- | --- |
| Clean `npm ci`, `npm run ci`, Pages build | Passed: 14 Pages checks, 45 Node tests, five intentionally failing fixture baselines, evaluation dry run |
| Existing editor, Monaco/recovery, approved Node runner, PTY/debugger, bounded repair browser workflows | All five passed |
| `test/android-workflow-browser.py` | Passed: actual QuickJS modules/assertions, timeout/memory/cancellation, result tampering, search, real offline Git commit/log/read, native-provider delegation with no page key, review reload/apply, stale-review/folder-link guards, mobile layout, v1 database migration, real QuickJS red/green repair |
| Native JVM tests | Five passed: provider formats with fake transports, endpoint/model/context rejection, error secrecy, path rejection, actual loopback HTTP redirect/declared-size/chunked-size checks |
| Android debug app and instrumentation APK assembly | Passed |
| New native instrumentation | **Not passed: zero tests executed.** Software API 35 emulator had app process-start ANR; Gradle reported process crashed. No KVM device is available here. This is a blocker, not a successful native gate. |

AI responses in browser repair tests and provider format tests are fixtures.
No real provider request, model-solving benchmark, native GitHub clone/push or
physical-device workflow has been certified. The previous accelerated API 35
success recorded in ANDROID.md covers the previous RC, not these new native
features. New tests include real Keystore encryption/persistence/AAD/removal,
a test-only DocumentsProvider for conflicts/save/exclusions, and QuickJS/provider
metadata inside Android WebView. They compile but must run on a ready device.

Reproduce with:

```sh
npm ci
npm run ci
npm run build:pages
npm run test:browser:android-workflow
# Plus the five existing browser scripts listed above / in AGENTS.md.
npm run android:sync
cd android
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
./gradlew :app:connectedDebugAndroidTest
cd ..
python3 scripts/verify-android-results.py
```

Do not remove the nonzero-test gate. Before release, run those native checks on
accelerated API 35, exercise real folder-provider/revoked-permission/partial-save
behavior and physical-device IME/rotation/background recovery, and opt in to any
real provider or remote Git tests. Preserve the existing release signing identity.
The debug APK cannot update a release-signed installation. Nothing in this draft
has been pushed, released, deployed or published.
