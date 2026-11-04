---
name: verify-search-ordering
description: Model-check omacast's async search ordering (TLA+/TLC) after changing how the launcher searches, cancels, applies results or activates rows. Use it for edits to ui/LauncherWindow.qml rebuild/perform/actionsForSelected or its revision handlers, services/NativeSearch.qml, Backend.qml searchAsync/rebuildCandidates, or search/src/protocol.rs, and before adding any new async result source (Phase 7 file and content search).
---

# Verify search ordering

omacast answers a typed query asynchronously: `LauncherWindow.rebuild()` asks `Backend.searchAsync()`, which hands root queries to `NativeSearch`, which talks to the `bin/omacast-search` helper over stdin/stdout. Keys, timers, helper replies and candidate reloads interleave freely. `tests/formal/SearchOrdering.tla` models that protocol, and TLC checks every interleaving within the bounds below.

## What it proves

| Property | In plain words | The harm if it breaks |
|---|---|---|
| `NoStaleActivation` | Enter, a click, Ctrl+1–9 or the action panel only act on rows computed for what is typed now. | Enter on a stale row launches the wrong thing; CLAUDE.md records Enter on a stale query opening real browser tabs. |
| `NoStaleOverwrite` | Results for an older query never replace the rows for the current one. | Rows flicker back to an old query, and Enter then hits the wrong row. |
| `RepliesMatchCatalog` | Flea hits are mapped to ids only through the catalog they were computed on. | `hit.index` points at a different app or command, so the row's title and action disagree. |
| `SettledRowsAreCurrent` | While the launcher is visible and not waiting, its rows belong to the current input. | The same as the first two, seen as a state rather than an event. |
| `SearchSettles` (liveness) | A search the visible launcher waits on always finishes, or the launcher hides. | Enter and Ctrl+K silently do nothing until the user types. |

## Run it

```sh
tests/formal/check.sh --safety     # the four invariants, ~10 s: run on every covered change
tests/formal/check.sh              # invariants, then SearchSettles (a full liveness pass is ~70 s)
tests/formal/check.sh --mutants    # ~5 s: proves each property can still fail
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

Last confirmed against the code at commit **`10e58bc`** (sync commit).

| Code | Model | Anchor |
|---|---|---|
| `ui/LauncherWindow.qml` `rebuild()` and its callback, `applySearch()` | `UiRebuild`, `UiCallback` | `GuardSerial`, `GuardRevision`, `CancelOnRebuild`, shape "rebuild sets searchPending…" |
| `ui/LauncherWindow.qml` `perform()` (Enter, Ctrl+Enter, Ctrl+1–9, click, panel entry) | `Activate` | `GuardPerform`, shape "perform and confirmAlert are the only callers of request()" |
| `ui/LauncherWindow.qml` `actionsForSelected()`, `toggleActionPanel()` | `OpenPanel` | `GuardActions` |
| `ui/LauncherWindow.qml` `confirmAlert()`, alert and panel Esc | `CloseOverlay` | none (no guard) |
| `ui/LauncherWindow.qml` `onShownChanged`, `prepare()`, `popToRoot()` | `Hide`, `Show`, `PopToRoot` | `CancelOnHide` |
| `ui/LauncherWindow.qml` `setQuery`, `push`, `pop`, `setRootFilter`, `recallHistory` | `Edit` | shape "every query write is followed by rebuild()" |
| `ui/LauncherWindow.qml` `onCandidatesRevisionChanged`, `onCalculatorRevisionChanged` | `Reindex` (last step), `CalcRevision` | `CalcSkipsAlert`, shapes for both conditions |
| `Backend.qml` `searchAsync()` | `UiRebuild` (sync and async members) | shape "Backend.searchAsync answers empty queries…" |
| `Backend.qml` `rebuildCandidates()` | `Reindex` | `CancelOnReindex`, shape "Backend swaps ids and entries…" |
| `services/NativeSearch.qml` `cancel()`, `search()`, `send()`, `load()` | `NsCancel`, `NsSearch`, `NsSend`, `NsLoad` | `SendOnlyWhenLoaded`, shapes for `search()` and `cancel()` |
| `services/NativeSearch.qml` `invalidate()` (onEntriesChanged) | `NsInvalidate` | `InvalidateCancels`, shape "invalidate() unloads…" |
| `services/NativeSearch.qml` `receive()` | `NsReceive`, `Receive` | `ReplyIdCheck`, shape "receive() marks the load done…" |
| `services/NativeSearch.qml` `fail()`, timeout `Timer`, helper `onStarted`/`onExited` | `NsFail`, `Timeout`, `HelperStart`, `HelperExit` | shapes for each |
| `search/src/protocol.rs` `run()` | `HelperStep` | shape "the helper answers one line at a time, in order" |

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

Several lines protect against the same thing. TLC shows that removing any one of these alone breaks no safety property: `GuardSerial`, `GuardRevision`, `CancelOnRebuild`, `CancelOnHide`, `CancelOnReindex` and `InvalidateCancels`.
- Stale replies are stopped by `NativeSearch` itself: it has a single pending slot, and `receive()` checks the id.
- A reply computed on the old catalog gets through only when `CancelOnReindex`, `InvalidateCancels` and `GuardRevision` are all gone. That's the `reindex-unguarded` mutant.

Don't delete these layers because the model says they're redundant: the model only covers what's listed here.

## Bounds and assumptions

- **Event budget.** `MaxEvents = 6` user and environment events per behaviour (show, hide, edit, activate, panel, overlay close, calculator update, pop-to-root), plus `MaxReindex = 2` candidate reloads. Helper and timer steps are unbounded.
  - Safety explores about 1.9 M distinct states with these bounds.
  - Each property's shortest counterexample needs at most 4 events.
- **Input.** Typed text, the pushed view and the root filter are one version counter. The model checks that rows belong to the current input, not what is ranked inside them.
- **Empty queries.** Whether a query is empty (the synchronous path) is chosen freely at each rebuild. This covers more behaviours than the code has, never fewer.
- **Writes before start.** Writes to the helper before it starts are buffered in order. If Quickshell dropped them instead, nothing would change: the `onStarted` load supersedes the only early write.
- **Helper failures.** A malformed or error reply can arrive at any time, and so can a helper exit. Either one is followed by `fail()`.
- **Fairness.** The helper, the receive path and the 1 s timeout are weakly fair. The user may stop at any time.
- **Combined anchors.** `CancelOnHide` stands for three lines and `InvalidateCancels` for two. Deleting only one of a group sets the whole constant `FALSE`, which is a slightly coarser model than the edit.

## Not covered

- Ranking, calculator maths and row contents.
- `rootSearch.performAction` outcomes beyond "opens an alert, rebuilds, or nothing".
- Toast, About and dropdown popups: they don't gate activation.
- `omacast run` over IPC, which doesn't use rows.
- The Omarchy menu source's own async loading.
- Real-time ordering: the model is untimed, and the 1 s timeout is just a possible event.
- Anything outside one launcher instance.

**Phase 7 file and content search** will stream ripgrep results through this same pattern of serial, pending and cancel. Add each new async source to the model as its own pending slot and reply action, with anchors, before trusting the check for it.

## Moving the sync commit

After a covered change:
1. Run `tests/formal/check.sh` and `tests/formal/check.sh --mutants`.
2. Read each changed covered function against its model operator.
3. Update `SearchOrdering.cfg` if a guard's intended value changed.
4. Change the sync commit above to the new `git rev-parse --short HEAD`, and only once the model describes the code at that commit.

To see what changed since the last sync:

```sh
git diff 10e58bc -- ui/LauncherWindow.qml services/NativeSearch.qml Backend.qml search/src/protocol.rs
```

`/maintain-formal-verification-skill` covers bringing this back in line after changes that skipped the check.
