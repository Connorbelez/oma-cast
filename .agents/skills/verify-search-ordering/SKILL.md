---
name: verify-search-ordering
description: Model-check omacast's async search ordering (TLA+/TLC) after changing how the launcher searches, cancels, applies results or activates rows. Use it for edits to ui/LauncherWindow.qml rebuild/perform/actionsForSelected/searchContents or its revision handlers, services/NativeSearch.qml, services/ContentSearch.qml, Backend.qml searchAsync/searchContents/rebuildCandidates, or search/src/protocol.rs, and before adding any new async result source.
---

# Verify search ordering

omacast answers a typed query asynchronously: `LauncherWindow.rebuild()` asks `Backend.searchAsync()`, which hands root queries to `NativeSearch`, which talks to the `bin/omacast-search` helper over stdin/stdout. The Search Files view has a second async source: 150 ms after the last keystroke, `searchContents()` asks `Backend.searchContents()`, which runs `rg` through `ContentSearch`. Keys, timers, helper replies, rg exits and candidate reloads interleave freely. `tests/formal/SearchOrdering.tla` models both sources, and TLC checks every interleaving within the bounds below.

## What it proves

| Property | In plain words | The harm if it breaks |
|---|---|---|
| `NoStaleActivation` | Enter, a click, Ctrl+1–9 or the action panel only act on rows computed for what is typed now. | Enter on a stale row launches the wrong thing; CLAUDE.md records Enter on a stale query opening real browser tabs. |
| `NoStaleOverwrite` | Results for an older query never replace the rows for the current one. | Rows flicker back to an old query, and Enter then hits the wrong row. |
| `RepliesMatchCatalog` | Flea hits are mapped to ids only through the catalog they were computed on. | `hit.index` points at a different app or command, so the row's title and action disagree. |
| `SettledRowsAreCurrent` | While the launcher is visible and not waiting, its rows belong to the current input, and so does a Contents section. | The same as the first two, seen as a state rather than an event. |
| `NoStaleContent` | A content reply for an older query never reaches the list. | Contents rows for `frec` show under the name rows for `frece`, and Enter opens one. |
| `ContentRunsAreCurrent` | An rg run that has not been signalled belongs to the current search serial. | Every keystroke leaves an rg walking the home dir for a query nobody waits for. |
| `HiddenRunsNoContent` | While the launcher is hidden, no rg run is unsignalled and the stillness timer is stopped. | rg keeps reading the user's files after the launcher hides, or starts 150 ms later. |
| `SearchSettles` (liveness) | A search the visible launcher waits on always finishes, or the launcher hides. | Enter and Ctrl+K silently do nothing until the user types. |

## Run it

```sh
tests/formal/check.sh --safety     # the seven invariants, ~1 min: run on every covered change
tests/formal/check.sh              # invariants, then SearchSettles (a full liveness pass is about 15 min)
tests/formal/check.sh --mutants    # ~11 s: proves each property can still fail
tests/formal/check.sh --set Name=VALUE   # override one model constant (repeatable)
```

Exit codes are 0 (all checked properties hold), 1 (a property is violated), 3 (the model is out of sync with the code) and 4 (toolchain error). Each run prints one `PASS`/`FAIL` line per TLC run, the trace as action names, and a log path under `~/.cache/omacast/tla/runs/`.

The toolchain is TLA+ tools 1.7.4. `check.sh` downloads `tla2tools.jar` into `~/.cache/omacast/tla/` and checks it against the sha256 pinned in the script. Java comes from `$OMACAST_JAVA`, then `java` on `PATH`, then `mise x java@temurin-25`. Nothing is written into the repo.

Read every result with the p3-stack `/statechart` skill, pointing it at `tests/formal/SearchOrdering.tla`, `tests/formal/SearchOrdering.cfg` and the run's log. For a violation it gives the shortest path in plain words. For a pass it draws how the launcher moves between states.

## How the model follows the code

`check.sh` runs `node tests/formal/anchors.js` before TLC. Anchors come in two kinds:

- **Guard anchors** are protective lines. Each one sets a model constant: `TRUE` when the line is in the code, `FALSE` when it's gone. Deleting a guard in the QML is therefore checked as deleting it in the model, with no hand edit needed. When the code differs from `SearchOrdering.cfg`, the run prints `code differs from the baseline cfg`.
- **Shape anchors** are code the model assumes as written: callback order, who calls `request()`, the six `window.query =` writes. If one stops matching, `check.sh` exits 3 with `MODEL OUT OF SYNC` and names the anchor. A pass is not trustworthy until you re-sync.

### Coverage record

Last confirmed against the code at commit **`a30199d`** (sync commit).

| Code | Model | Anchor |
|---|---|---|
| `ui/LauncherWindow.qml` `rebuild()` and its callback, `applySearch()` | `UiRebuild`, `UiCallback` | `GuardSerial`, `GuardRevision`, `CancelOnRebuild`, shape "rebuild sets searchPending…" |
| `ui/LauncherWindow.qml` `perform()` (Enter, Ctrl+Enter, Ctrl+1–9, click, panel entry) | `Activate` | `GuardPerform`, shape "perform, confirmAlert and pick are the only callers of request()" |
| `ui/LauncherWindow.qml` `actionsForSelected()`, `toggleActionPanel()` | `OpenPanel` | `GuardActions` |
| `ui/LauncherWindow.qml` `confirmAlert()` and `pick()` (each replays the payload its alert or picker opened with), alert, picker and panel Esc | `CloseOverlay` | none (no guard) |
| `ui/LauncherWindow.qml` `onShownChanged`, `prepare()`, `popToRoot()` | `Hide`, `Show`, `PopToRoot` | `CancelOnHide` |
| `ui/LauncherWindow.qml` `setQuery`, `push`, `pop`, `setFilter` (the root filter and the Names / Contents dropdown), `recallHistory` | `Edit` | shape "every query write is followed by rebuild()" |
| `ui/LauncherWindow.qml` `onCandidatesRevisionChanged`, `onCalculatorRevisionChanged` | `Reindex` (last step), `CalcRevision` | `CalcSkipsAlert`, shapes for both conditions |
| `Backend.qml` `searchAsync()` | `UiRebuild` (sync and async members) | shape "Backend.searchAsync answers empty queries…" |
| `Backend.qml` `rootSearch.search` and `rootFileHits()` (the root Files section) | the reply's `rows` in `UiCallback`: ranked in the same task, so no slot of its own | shapes "the root Files section is ranked inside rootSearch.search…" and "rootFileHits ranks synchronously…" |
| `Backend.qml` `rebuildCandidates()` | `Reindex` | `CancelOnReindex`, shape "Backend swaps ids and entries…" |
| `services/NativeSearch.qml` `cancel()`, `search()`, `send()`, `load()` | `NsCancel`, `NsSearch`, `NsSend`, `NsLoad` | `SendOnlyWhenLoaded`, shapes for `search()` and `cancel()` |
| `services/NativeSearch.qml` `invalidate()` (onEntriesChanged) | `NsInvalidate` | `InvalidateCancels`, shape "invalidate() unloads…" |
| `services/NativeSearch.qml` `receive()` | `NsReceive`, `Receive` | `ReplyIdCheck`, shape "receive() marks the load done…" |
| `services/NativeSearch.qml` `fail()`, timeout `Timer`, helper `onStarted`/`onExited` | `NsFail`, `Timeout`, `HelperStart`, `HelperExit` | shapes for each |
| `search/src/protocol.rs` `run()` | `HelperStep` | shape "the helper answers one line at a time, in order" |
| `ui/LauncherWindow.qml` `rebuild()` and `onShownChanged` calling `cancelContents()`, and `cancelContents()` itself | `UiCancelContents` inside `UiRebuild` and `Hide` | `CancelContentOnRebuild`, `CancelContentOnHide`, shape "cancelContents stops the stillness timer, then cancels ContentSearch" |
| `ui/LauncherWindow.qml` `rebuild()` restarting `contentDelay` in the files view; `popToRoot()` | the third `UiRebuild` member (synchronous, shown only) | shapes "rebuild restarts the stillness timer only in the files view…", "popToRoot leaves the files view before its rebuild…", "the files view answers synchronously…" |
| `ui/LauncherWindow.qml` `contentDelay`, `searchContents()` and its callback, `applyContents()` | `ContentFire`, `UiContents`; `UiCallback` clears the section | `ContentSerialCheck`, shapes "contentDelay is the only caller of searchContents()", "applySearch replaces every row…" |
| `Backend.qml` `searchContents()`, `cancelContents()` | inside `ContentFire` (the reveal rule is the first member) and `UiCancelContents` | shapes "Backend.searchContents hands the request's serial back…", "Backend.cancelContents is ContentSearch.cancel" |
| `services/ContentSearch.qml` `search()`, `start()`, `cancel()` | `CsSearch`, `CsStart`, `CsCancel` | shapes for each |
| `services/ContentSearch.qml` `kill()` and the 300 ms `killTimer` | `ContentKill` | shapes "kill() signals the pending request's run and keeps the request pending", "the kill timer calls kill()" |
| `services/ContentSearch.qml` `finished()`, the run's `onExited` and output, the watchdog | `ContentExit` | `ContentPendingCheck`, shapes "finished() waits for exit and output…", "the run's exit reaches finished()" |

## Fixed finding: a dead launcher after an alert

`SearchSettles` failed on `98bd0bb`. It passes since the fix that added `!window.alert` to `onCalculatorRevisionChanged`, and the baseline `SearchOrdering.cfg` now has `CalcSkipsAlert = TRUE`.

The path was: Enter on a row whose action asks first (Shut Down) opens the alert. While it's open, exchange rates or time zones arrive, and `onCalculatorRevisionChanged` calls `rebuild(false)`, which sets `searchPending = true` and starts a helper search. Then the candidates reload. `rebuildCandidates()` cancels the helper search, and `onCandidatesRevisionChanged` skips its rebuild because the alert is open. Nothing clears `searchPending`. After Esc, Enter and Ctrl+K do nothing until the user types, navigates or hides the launcher.

- **Shortest trace:** `Show -> Activate (alert) -> CalcRevision -> Reindex`.
- **Regression check:** `tests/formal/check.sh --liveness --set CalcSkipsAlert=FALSE` must still fail (about 3 s). TLC's liveness trace is not always the shortest, but it contains `Activate` (alert) then `CalcRevision` then `Reindex`. If it passes, the model lost the path.

Any liveness failure on the current code is now a new failure.

## A failure: real bug or modelling error?

1. **Exit 3 (out of sync).** The code changed where the model makes an assumption. Read the named anchor's function. If the behaviour is the same and only the text moved, update the pattern in `tests/formal/anchors.js`. If the behaviour changed, change the operator in the coverage table first, then the anchor.
2. **`code differs from the baseline cfg` plus a FAIL.** A guard line is gone or was reworded. If you meant to remove it, the trace shows what it protected. Restore it, or add the protection elsewhere and teach the anchor where to look. If you only reworded it, fix the anchor pattern so it finds the line again.
3. **A FAIL with no drift.** Replay the trace against the code with `/statechart`, one action per JS task: a key press, a timer, one helper line or one candidate reload. If each step is something the code really does in that order, it's a bug: report it with the trace in the code's words. If a step is impossible in the code (for example, two things the code does in one task appear as two actions), the model is wrong: fix the operator, and record the change in the coverage table.
4. **Never** weaken a property, shrink the bounds, or add a fairness condition just to turn a FAIL into a PASS.

After any change to the model or anchors, run `tests/formal/check.sh --mutants`. Every row must print `ok`. A `BAD` row means a property can no longer fail.

## Defence in depth (observed, not a bug)

Several lines protect against the same thing. TLC shows that removing any one of these alone breaks no safety property: `GuardSerial`, `GuardRevision`, `CancelOnRebuild`, `CancelOnHide`, `CancelOnReindex`, `InvalidateCancels`, `ContentSerialCheck` and `ContentPendingCheck`.
- Stale replies are stopped by `NativeSearch` itself: it has a single pending slot, and `receive()` checks the id.
- A reply computed on the old catalog gets through only when `CancelOnReindex`, `InvalidateCancels` and `GuardRevision` are all gone. That's the `reindex-unguarded` mutant.
- A stale content reply is stopped by the view's serial check and by `ContentSearch.finished()`, which delivers only the pending request's run (a rebuild cancels the old one). It gets through only when the serial check goes with one of the other two, which the `content-unguarded` and `content-no-cancel` mutants show.

Don't delete these layers because the model says they're redundant: the model only covers what's listed here.

## Bounds and assumptions

- **Event budget.** `MaxEvents = 6` user and environment events per behaviour (show, hide, edit, activate, panel, overlay close, calculator update, pop-to-root), plus `MaxReindex = 2` candidate reloads. Helper, timer and rg steps are unbounded.
  - Safety explores about 15.3 M distinct states with these bounds, in about 52 s on 24 cores. It was 1.9 M before the content source.
  - Each property's shortest counterexample needs at most 4 events.
- **Input.** Typed text, the pushed view and the root filter are one version counter. The model checks that rows belong to the current input, not what is ranked inside them.
- **Empty queries.** Whether a query is empty (the synchronous path) is chosen freely at each rebuild. This covers more behaviours than the code has, never fewer.
- **Writes before start.** Writes to the helper before it starts are buffered in order. If Quickshell dropped them instead, nothing would change: the `onStarted` load supersedes the only early write.
- **Helper failures.** A malformed or error reply can arrive at any time, and so can a helper exit. Either one is followed by `fail()`.
- **Fairness.** The helper, the receive path and the 1 s timeout are weakly fair. The user may stop at any time. The content steps carry no fairness: `SearchSettles` is about `searchPending`, which the content source never sets.
- **Content requests.** A content request is named by its serial. The stillness timer starts at most one request per rebuild, and every rebuild bumps the serial, so this matches `ContentSearch`'s identity check on the request object. Whether the reveal rule says yes is chosen freely at each firing.
- **The rg run.** Its output and its exit are one step, `ContentExit`, because `finished()` waits for both. A run signalled by `cancel()` or `kill()` may still exit at any later time, and the watchdog's forced finish is the same step.
- **Combined anchors.** `CancelOnHide` and `ContentSerialCheck` stand for three lines each and `InvalidateCancels` for two. Deleting only one of a group sets the whole constant `FALSE`, which is a slightly coarser model than the edit.

## Not covered

- Ranking, calculator maths and row contents.
- `rootSearch.performAction` outcomes beyond "opens an alert, rebuilds, or nothing".
- Toast, About and dropdown popups: they don't gate activation.
- `omacast run` over IPC, which doesn't use rows, and `files.searchContents` over IPC, which shares `ContentSearch` with the view and can cancel its request.
- What rg finds, the reveal rule's answer, and the 4,096-character and 1,000-file bounds in the content script (the privacy and content-search tests cover them).
- The Omarchy menu source's own async loading.
- Real-time ordering: the model is untimed, and the 1 s timeout is just a possible event.
- Anything outside one launcher instance.

The root Files section (P7-4) is not a new source: `rootSearch.search` ranks file names in the task that builds the reply, so the section rides the existing serial guard. Content search (P7-5) is the second source, with its own pending slot (`cs.req`), run (`cs.run`), cancel and reply step. Add any further async source the same way, with anchors, before trusting the check for it.

## Moving the sync commit

After a covered change:
1. Run `tests/formal/check.sh` and `tests/formal/check.sh --mutants`.
2. Read each changed covered function against its model operator.
3. Update `SearchOrdering.cfg` if a guard's intended value changed.
4. Change the sync commit above to the new `git rev-parse --short HEAD`, and only once the model describes the code at that commit.

To see what changed since the last sync:

```sh
git diff a30199d -- ui/LauncherWindow.qml services/NativeSearch.qml services/ContentSearch.qml Backend.qml search/src/protocol.rs
```

`/maintain-formal-verification-skill` covers bringing this back in line after changes that skipped the check.
