# Phone editing rebuild — 0.17 development draft

This update addresses the problems reproduced in the 0.16 APK's phone interface.
It preserves the existing project/draft keys, snapshot database, release signing
identity, optional provider security and ₹0 default.

## Editing and navigation

Phones use a bundled CodeMirror 6 editor by default, with syntax highlighting,
completion, indentation, paired brackets and per-file undo/redo. JavaScript,
TypeScript/JSX, HTML, CSS, JSON, Python and Markdown have bundled syntax support;
syntax support does not imply that all those languages can execute on-device.
Font size starts at 16px with wrapping on when no user preference exists.

The editor retains undo history through Save and file switching. Selection and
scroll position transfer when changing between touch and desktop editors; the
chosen editor, active file and view position are restored on reload. Switching
projects clears incompatible editor history. Cursor arrows use the editor's
character movement, preserving emoji boundaries. The legacy textarea remains a
persistence adapter and desktop fallback; it is hidden during touch editing.

Phone chrome prioritizes code: a project/save-status header, file tabs with an
always-accessible menu, a 48px editing strip, a Save/Preview footer and section
navigation. Short viewports hide the outer header/navigation. The touch landscape
layout remains active up to 1100px wide. Primary actions have at least 48×48px
hit areas at tested sizes, including 320px-wide portrait. Preview has an explicit
**Edit code** return action. Selecting a file returns directly to the editor.

The menu contains search/replacement, settings, diagnostics, file management,
execution options, backups, provider configuration and code-symbol insertion.
Native Back closes app dialogs or returns to code before backgrounding the app;
root Back flushes draft/view metadata. Its native Android integration compiles
but still needs device validation.

## Save destinations and recovery

**Save in app** stores the project inside Vynqode. It does not claim to update an
external file. An explicitly opened writable device folder changes the button to
**Save file**, which writes that folder. The header shows the destination and
pending/saved status. A read-only grant keeps Save in app available and labels
that state. Folder links remain bound to their project session; reopening after
restart is deliberate so external changes can be checked before writing.

Ordinary native folder saves no longer ask for a second confirmation. Native
saving still performs conflict checks, private recovery and byte verification.
Deletion requires a separate native confirmation. The non-deletion path refuses
an unexpected deletion even if the file set changed between planning and saving.
A save is disabled while in progress. Cancellation retains the app copy; conflicts
show a readable message and preserve editor content.

Automatic recovery checkpoints reuse identical source and rotate the last eight
unreferenced automatic checkpoints. Task-referenced checkpoints and all existing
manual snapshots are protected. The manual limit stays 25; filling it no longer
blocks normal folder saves/opening or other automatic recovery operations.
Automatic entries are labelled **Recovery**. A failed new checkpoint transaction
rolls back its removals as well as the new write.

## Verification recorded — 2026-10-31

- Clean Node 22 install, Pages build (25 root assets), 14 Pages checks and 48 Node
  tests passed; fixture baselines and evaluation dry-run remained intact.
- Ten real Chromium browser workflows passed, including the new touch-enabled
  phone editor acceptance script. Model/provider/native transport fixtures are
  explicitly mocked where used; editing, history, persistence and execution tests
  exercise real implementations.
- The phone checks cover typing, syntax spans, undo/redo across Save and files,
  range handoff, mode/active-file reload, emoji movement, preview return, menu Back,
  portrait/landscape, 48px controls, and an editor at least 200px high in the
  360×400 compact simulation. The old APK's textarea was measured at 65px there.
- Real IndexedDB tests fill all 25 manual slots, create over 25 automatic
  checkpoints, preserve manual/task snapshots and continue using folder actions.
  A mocked native delegate checks unified Save, read-only routing and conflicts
  without claiming Android SAF was exercised.
- Eight native JVM tests passed. App and instrumentation debug APK assembly
  succeeded. Instrumentation now also checks the touch editor's document/history
  in WebView and the native deletion guard; these device tests remain unrun.
- The APK verifier confirms the same debug certificate/application ID and a
  versionCode increase from the previous test APK (3 → 4). This is artifact
  compatibility evidence, not an executed installed-upgrade test.

Run `npm run test:browser:phone` after a clean install. The existing browser
workflow scripts and `npm run ci` are listed in AGENTS.md. Android checks require
JDK 21/SDK 35; run `npm run android:sync`, native JVM tests, debug assembly and
instrumentation on a ready device. Keep the required-class/nonzero result gate.

## Remaining boundaries

Touch-enabled Chromium and shortened viewports do not reproduce physical Gboard,
Samsung Keyboard, CJK composition, TalkBack or the actual Android IME. Those,
real folder-provider saves/revocations, native Back, and installed upgrades still
need device coverage. There is no usable accelerated Android device in this
cloud environment; APK compilation is not a native-runtime pass.

The device runner remains bounded synchronous JavaScript and HTML preview.
Embedded Node/npm, Python execution, arbitrary framework builds and hosted
services remain additional work. The USB computer companion is optional and
requires a computer. Real AI quality and provider/GitHub transfers remain separate
validation scopes. No release, push, deployment or environment publication was
performed for this draft.
