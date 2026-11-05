# Phase 7 file search plan

Phase 7 gives omacast users a Search Files command and a Files section in root search, built on `rg --files` over `$HOME` and `~/.config` instead of a persistent index. Vendor trees such as `~/Applications/UnrealEngine` are detected and left out, file names are ranked in match bands with a bounded usage lift, and content matches appear only when few names match. The decisions and the measurements behind them are in `SPEC.md §8.6` and `docs/phase7-prototypes/`. The program enforces one rule. Every PR proves itself on the live launcher through `verify-omacast`, and no query text ever reaches a process's argv.

The PRs in order are P7-1 list files, P7-2 rank files and the Search Files view, P7-3 preview and file actions, P7-4 the root Files section, P7-5 content results, P7-6 the Neovim signal.

## How to read this
One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `skills/p3-mode/playbooks/autopilot-stack.md`. Owners stop at merge-ready and the operator lands every PR. All six PRs are the operator's items. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist
### Arm the program
- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Run `setup-p3` if `p3-models.md` is still missing from `~/.claude/skills/p3-mode/`. This plan names the `swarm workers` role from that file and was written while the file was absent.
- [ ] Read these from trunk at program start, and re-read them at every tick. `git show origin/main:skills/p3-mode/playbooks/autopilot-stack.md`, `git show origin/main:skills/swarm/SKILL.md`, `git show origin/main:skills/p3-mode/playbooks/opening-a-pr.md`, `git show origin/main:skills/verify-omacast/SKILL.md`, `git show origin/main:skills/verify-search-ordering/SKILL.md`, `git show origin/main:skills/benchmark-checklist/SKILL.md`. The two omacast skills live in this repo under `.agents/skills/`, so read them from the checkout when the trunk path is absent.
- [ ] On the operator's go, arm the audit tick with `schedule_task` on `{"type":"interval","everyMs":3600000}` and the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners
- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Every PR is a Graphite branch on its parent, so dependent work starts on the parent branch as soon as the parent is code-ready, and `gt restack` carries later parent changes down.
  - [ ] P7-1 is first and branches from `main`.
  - [ ] P7-2 after P7-1.
  - [ ] P7-3 after P7-2.
  - [ ] P7-4 after P7-2. P7-4 and P7-3 are independent of each other.
  - [ ] P7-5 after P7-3.
  - [ ] P7-6 after P7-2. It is last in priority and may be dropped if `main.shada` stays empty on the dev machine.
- [ ] Hold the file boundaries. P7-1 touches only `core/FileIndex.js`, `services/FileLister.qml`, `Backend.qml`, `bin/omacast`, `tests/file-index.test.js`, `tests/privacy.test.js` and `SPEC.md`. P7-2 touches only `core/FileRanker.js`, `services/UsageSignals.qml`, `core/RootSearch.js`, `ui/LauncherWindow.qml`, `Backend.qml`, `tests/file-ranker.test.js` and `tests/fixtures/`. P7-3 touches only `ui/FilePreview.qml`, `ui/LauncherWindow.qml`, `services/FileActions.qml`, `Backend.qml` and `tests/file-actions.test.js`. P7-4 touches only `core/RootSearch.js`, `Backend.qml`, `ui/LauncherWindow.qml`, `tests/rootsearch.test.js` and `tests/formal/`. P7-5 touches only `services/ContentSearch.qml`, `core/FileRanker.js`, `ui/LauncherWindow.qml`, `Backend.qml`, `tests/content-search.test.js`, `tests/privacy.test.js` and `tests/formal/`. P7-6 touches only `core/Shada.js`, `services/UsageSignals.qml` and `tests/shada.test.js`.
- [ ] Hold the review gate. P7-1, P7-2, P7-3, P7-4 and P7-5 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR
- [ ] Graphite (`gt`) manages the stack and opens the PRs. The operator chose it on 2026-11-04, and that choice replaces the playbook's "never require Graphite" line for this program. `gh` stays for `pr view`, `pr checks`, `pr edit` and the merge. Call `link_pull_request` for every PR the moment it opens.
- [ ] `origin` is the operator's fork `Connorbelez/oma-cast`, and `gt submit` opens every PR there. Never add `typecraft-dev/oma-cast` as a remote in this program.
- [ ] Create each branch from its parent so Graphite records the stack. `gt checkout <parent-branch> && gt create <branch>` for a child, and `gt checkout main && gt create <branch>` for P7-1. Commit with `git commit` or `gt modify`. Push and open the PR with `gt submit --no-interactive --no-edit`, which targets the parent branch. From a branch with children, `gt submit --stack` resubmits the descendants too. Never pass `--draft`.
- [ ] `gt submit` refuses the fork until the operator syncs it with Graphite at `https://app.graphite.com/settings/synced-repos` (observed on 2026-11-04: "You can only submit to repos synced with Graphite"). Until then, open the PR on the `gt`-created branch with `gh pr create --repo Connorbelez/oma-cast --base <parent-branch>` after `git push -u origin <branch>`. The stack shape is the same either way, and `gt submit --stack` takes over once the repo is synced.
- [ ] When a parent branch moves, run `gt restack` from the top of the stack and submit again from the root with `gt submit --stack --no-interactive --no-edit`. Rebase onto trunk with `gt sync --no-interactive` followed by `gt restack`.
- [ ] Run `node --test tests/*.test.js` and `omarchy plugin validate .` once before the PR-facing push. Push with hooks on.
- [ ] Run the **unslop** skill before each commit and the **no-comments** skill before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk with `gt sync` and `gt restack` before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, or on a CI failure that comes from a change on trunk.

### Verdict and merge, for every PR
- [ ] At the code-ready head SHA and at each later push that changes the patch, run the swarm per `skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] The live lanes run one at a time. There is one `omarchy-shell` per session and `omacast-verify launch` refuses to start while another run is active. Dispatch the ten lanes to one worker in sequence, or to several workers that retry `launch` until the lock frees. The audit and perf lanes still run in parallel with each other.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh swarm and a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] The root leaves a verified PR in the Graphite stack and the operator lands the stack bottom-up with `gt merge` or the GitHub merge button. Nobody else merges. A later head on a parent restacks its children with `gt restack`, and an earlier verdict survives only when `git patch-id` is unchanged, per `playbooks/shipping.md`.

### Boot recipe, for every live lane
Each live lane is a delegated worker at the PR head. Use `delegate_task` with `isolation: "worktree"` for an independent worker checkout. The surface is the launcher overlay inside the user's `omarchy-shell`, driven through `.agents/skills/verify-omacast/scripts/omacast-verify`, called `$V` below. There is no `preview_*` or `device_*` surface.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] `$V launch`, which links the worktree into `~/.config/omarchy/plugins` or reloads it, then `$V doctor`. Ready means `doctor` reports no QML errors and the checkout commit equals the head SHA.
- [ ] Deliver input only through `$V open`, `$V type`, `$V key`, `$V run` and `$V hide`. Read-only diagnostics are `$V call <method>`, `$V titles`, `$V log 120` and `qs log -n -p "$OMARCHY_PATH/shell" -t 50`. Clear the query with `$V key ctrl+u` before typing, because the query survives hide and show.
- [ ] Save every screenshot with `$V shot <slug>`, copy it to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png`, and return the paths with the report. The capture is the whole monitor, so crop before it leaves the machine.
- [ ] `$V cleanup` at the end, and undo any store change the lane made (`db/frecency.json`, `db/settings.json`, `~/.config/omacast/file-search.ignore`).

## List files and detect large untouched subtrees (P7-1)
**Depends on.** None.

**Files.**
- [ ] Create `core/FileIndex.js`. Pure JS. The default ignore list, the private-path list, `largeSubtrees(paths, signals, threshold)` as prototyped in `docs/phase7-prototypes/detect.py`, and `parseList(text)` into `{ path, name, dir }` rows.
- [ ] Create `services/FileLister.qml`. Runs `rg --files --ignore-file <file> <root>` for `$HOME` and for `~/.config --hidden` through `Process` with `SplitParser`, holds the list, the refresh timer, the daily full pass and the large-subtree toast state.
- [ ] Edit `Backend.qml`. Register the `files` RPC group with `files.list`, `files.refresh`, `files.largeSubtrees` and `files.ignore`. Create `~/.config/omacast/file-search.ignore` with the defaults on first start, mode 0600.
- [ ] Edit `bin/omacast`. `omacast doctor` prints the file count, the roots, the ignore file path and the large untouched subtrees.
- [ ] Create `tests/file-index.test.js`. Edit `tests/privacy.test.js`.
- [ ] Edit `SPEC.md §8.6` with the real home's first `files: listed` time after the operator's next reboot, beside the loop-image floor.

**Build.**
- [ ] `FileIndex.largeSubtrees` returns the topmost directories over the threshold with no signal inside, walking top down. Signals are the zoxide list and the active git repos, read once per refresh by `FileLister`.
- [ ] `FileLister.refresh()` runs both `rg` passes, swaps the list in one assignment when both finish, and keeps the old list on failure. It runs when the launcher hides and the list is older than 30 s, so it never competes with typing or painting, and when the launcher opens with a list older than 10 minutes (deferred 250 ms) [D, 2026-11-04: the open-time refresh contended with the GUI thread and twice took over 100 ms]. It never overlaps a refresh in flight, and a request made during one runs right after it.
- [ ] `FileLister` runs the full `rg --files $HOME` recount once a day, feeds it to `largeSubtrees`, and writes the result to `files.largeSubtrees`.
- [ ] The toast "Skipping ~/Applications/UnrealEngine (300,136 files)" shows once per detected tree, with the action "Add to Ignore File" on Ctrl+T (the footer shows about 52 characters, so the title carries no question). Ctrl+T then ↵ appends the path to the ignore file and refreshes. Esc records the time in `db/settings.json` `fileSearch.askedAt[path]` and asks again after 7 days.
- [ ] Every `rg` invocation has fixed argv. The roots and the ignore file path are the only arguments, and the privacy test asserts it.

**You see.**
- [ ] `omacast call files.list '{}' | jq .data.count` prints a number near 14,949 on the dev machine within 100 ms of the launcher's first open, and `qs log` shows `[omacast] files: listed 14949 paths in 12 ms`.
- [ ] `omacast call files.largeSubtrees` prints `~/Applications/UnrealEngine` and `~/node_modules` with their counts, and not `~/Dev`.
- [ ] The toast appears in the launcher footer on the first open after install.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] `tests/file-index.test.js` feeds a fixture list of 40 paths with one 6-file vendor tree, one 6-file tree holding a zoxide signal, and a threshold of 5, and expects exactly the vendor tree. It also checks the default ignore text and the private paths. Run `node --test tests/file-index.test.js`.
- [ ] `tests/privacy.test.js` gains a case that scans `services/FileLister.qml` for `command:` arrays and fails when any element is not a literal, a root or the ignore file path. Run `node --test tests/privacy.test.js`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the `swarm workers` role in `p3-models.md` at the PR head, per the boot recipe.
- [ ] Lane 1. Regression lane against trunk. Run `tests/smoke.sh` at trunk and at head. Trunk lacks the feature, so the lane gates the show-to-mapped latency the user waits for. Save `smoke-head.png` after the last toggle. Pass when head's show-to-mapped median is within 10 ms of trunk's and under 100 ms.
- [ ] Lane 2. First open after install. `$V launch`, `$V open`, `$V shot first-open`. Pass when the toast names `~/Applications/UnrealEngine` with its count and `$V call files.largeSubtrees` lists both vendor trees and not `~/Dev`.
- [ ] Lane 3. Accept the toast. `$V open`, `$V key ctrl+t`, `$V key enter`, `$V shot toast-accepted`. Pass when `~/.config/omacast/file-search.ignore` gains the path, mode stays 0600, and the toast is gone on the next `$V open`.
- [ ] Lane 4. Dismiss the toast. Remove the ignore line, `$V open`, `$V key escape`, `$V shot toast-dismissed`. Pass when `db/settings.json` holds `fileSearch.askedAt` for the path and the toast does not return on the next `$V open`.
- [ ] Lane 5. Refresh timing. `$V open`, wait 31 s, `$V hide`, wait 1 s, `$V open`. Save the `$V log 120` output as `refresh-timing.txt`. Pass when `qs log` shows exactly two `files: listed` lines, the second one logged after the hide and under 100 ms (the perf block's median rule carries the 50 ms bar; a single sample alternates between about 22 and 57 ms with the engine's garbage collection, measured 2026-11-04), and no listing between the second open and a hide within 30 s.
- [ ] Lane 6. Refresh keeps the old list on failure. Point `files.refresh` at a root that does not exist through `$V call files.refresh '{"roots":["/nonexistent"]}'`. Save the `$V call` output as `refresh-keeps-the-old-list-on-failure.txt`. Pass when `files.list` still returns the previous count and `qs log` shows one `files: rg exited` warning.
- [ ] Lane 7. Hidden config root. Save the `$V call` output as `hidden-config-root.txt`. Pass when `$V call files.list` contains `~/.config/hypr/hyprland.lua` and contains no path under `~/.config/chromium`, `~/.config/zen`, `~/.ssh` or any `Cache/` directory.
- [ ] Lane 8. No query in argv. During `$V open`, run `ps -eo args | grep '[r]g '`. Save the output as `ps-argv.txt`. Pass when every `rg` line holds only `--files`, `--hidden`, `--ignore-file`, the two omacast ignore paths (`~/.config/omacast/file-search.ignore` and `~/.cache/omacast/file-search-untouched.ignore`) and a root.
- [ ] Lane 9. Doctor. `omacast doctor`. Save `doctor.txt`. Pass when it prints the file count, both roots, the ignore file path and the two vendor trees.
- [ ] Lane 10. Uninstall leaves nothing extra. `bin/omacast uninstall`, then `$V launch` and `bin/omacast reload` (the shell caches QML by path, so a reinstall at the plain plugin path serves the old code until a reload; that is the install flow's behaviour from before Phase 7 and a follow-up outside P7-1). Save the `$V log 120` output as `uninstall-leaves-nothing-extra.txt`. Pass when `~/.config/omacast/file-search.ignore` survives (it is user config) and `files.list` repopulates within 100 ms of the first open.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Show-to-mapped and hide-to-unmapped latency from `tests/smoke.sh` at trunk and head. Trunk lacks the feature, so also the diff-added work, the warm refresh time from the `files: listed` log line, and the end state the user waits for, which is `files.list` populated after the first open made at least 1 s after plugin load (an open within the shell's plugin incubation is a reload stress case, recorded as a follow-up on 2026-11-04 after it delayed the list by up to 269 ms).
- [ ] Probe. Run `tests/smoke.sh` five times per side, alternating trunk and head, with no key driving in parallel. Read the refresh time from `qs log` on each head run.
- [ ] Baseline. Record trunk's show-to-mapped median first. It was 59 to 66 ms on Omarchy 4.0.6.
- [ ] Rule. Head's show-to-mapped median exceeds trunk's by more than 10 ms, fails. The median of at least ten warm refreshes over 50 ms, or any single one over 100 ms, fails (loosened from "any over 50 ms" on 2026-11-04 after the swarm measured 10 of 11 at 22 to 40 ms and one at 58 ms with the same work each time, so the outlier is the shell's GUI thread scheduling, not the listing; countersigned in the trail). `files.list` empty 200 ms after a first open made at least 1 s after plugin load, fails. The warm refresh samples are taken with the launcher hidden, which is where the refresh now runs.
- [ ] Cold listing on the real home. The loop-image floor from `docs/phase7-prototypes/cold-loop.sh` is 36 to 74 ms for the working list and 632 to 738 ms for the full home. Read the first `files: listed` line from `qs log` after the operator's next reboot and record it in `SPEC.md §8.6`. If the operator can run `sudo sysctl -w vm.drop_caches=3 && docs/phase7-prototypes/cold.sh`, record its numbers too. A real-home cold listing over 1 s triggers the persistent index design in §8.6 and stops the program for a decision.

**Review gate.** The operator reviews before merge.
- [ ] Copy lane 2 and lane 3 screenshots into `docs/screenshots/phase7/p7-1-review-toast.png` and `docs/screenshots/phase7/p7-1-review-accepted.png`.
- [ ] Record a 30 to 60 second video of the toast appearing, ↵ accepting it, and `omacast doctor` on a live lane. Save it as `docs/screenshots/phase7/p7-1-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**
- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## Rank files and open the Search Files view (P7-2)
**Depends on.** P7-1.

**Files.**
- [ ] Create `core/FileRanker.js`. Pure JS. `band(query, row)` with the seven bands of `SPEC.md §8.6` through one `RegExp` per name, `usage(row, signals)`, `rank(rows, query, signals)` with the bounded lift, and `recent(rows, signals)` for the empty query.
- [ ] Create `services/UsageSignals.qml`. Reads `zoxide query --list --score` and the active git repos on refresh, exposes `dirScore` and the omacast opens from `frecencyStore`.
- [ ] Edit `core/RootSearch.js`. Add the `builtin:search-files` command with `run: { push: { kind: "files", title: "Search Files" } }`.
- [ ] Edit `ui/LauncherWindow.qml`. The `files` view kind with its placeholder "Search files…", rows from `files.search`, the empty-query "Recent & frequent files" section, and ↵ as Open through `xdg-open` on stdin-free argv (the path is the file's own, not user text).
- [ ] Edit `Backend.qml`. Register `files.search` and `files.open`, and record each open in `frecencyStore` keyed by absolute path.
- [ ] Create `tests/file-ranker.test.js` and `tests/fixtures/files-query-set.json`.

**Build.**
- [ ] `FileRanker.band` uses `new RegExp` built from the escaped query for prefix, word start, substring and subsequence, and never a character loop. The exact band compares the lowercased name and stem.
- [ ] `FileRanker.rank` sorts by band, then by `ln(1 + opens / 100) + 0.5 × recency + 0.5 × prior`, then by shorter name, and applies the lift only when the row's own opens are at least 100 and its band is 2 or higher.
- [ ] The `files` view asks `files.search` on every keystroke through the existing `searchAsync` serial guard, so a late reply for an older query is dropped.
- [ ] `files.open` writes the frecency record before launching `xdg-open`, and the HUD shows the file name.

**You see.**
- [ ] In the launcher, `search files` ↵ pushes the view. Typing `oma spec` shows `SPEC.md` in `~/Projects/oma-cast` as the first row with its directory as the subtitle.
- [ ] An empty query shows "Recent & frequent files" with the files opened from omacast first.
- [ ] `qs log` shows `[omacast] files: ranked 688 of 14949 in 4 ms` for `spec`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] `tests/file-ranker.test.js` replays `tests/fixtures/files-query-set.json`, the 13 queries and targets from `docs/phase7-prototypes/README.md` over a fixture list of 200 paths with the same synthetic opens, and expects each target's rank under the bounded-lift policy. It also asserts the two adversarial cases, a fifty-times-opened prefix match never beats the exact match and a twenty-times-opened subsequence match never beats a prefix match. Run `node --test tests/file-ranker.test.js`.
- [ ] A test asserts that `core/FileRanker.js` contains no `for` loop over the characters of a name. Run `node --test tests/file-ranker.test.js`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the `swarm workers` role in `p3-models.md` at the PR head, per the boot recipe.
- [ ] Lane 1. Regression lane against trunk. At trunk and head, `$V open`, `$V key ctrl+u`, `$V type "firefox"`, `$V shot root-firefox`. Pass when the Results section's first row is the same app on both sides and head's `rootSearch.search` call time is within 10 ms of trunk's.
- [ ] Lane 2. Push the view. `$V open`, `$V type "search files"`, `$V key enter`, `$V shot files-empty`. Pass when the header shows "Search Files" and the placeholder "Search files…".
- [ ] Lane 3. Path band. `$V type "oma spec"`, `$V shot files-oma-spec`. Pass when the first row is `SPEC.md` under `~/Projects/oma-cast`.
- [ ] Lane 4. Exact beats usage. Set `db/frecency.json` to 5,000 for a `Spec*` file outside oma-cast through `$V call frecency.record`, `$V type "spec"`, `$V shot files-spec-exact`. Pass when `SPEC.md` stays first. Undo the record.
- [ ] Lane 5. Bounded lift. Record two opens for `~/Dev/sales-crm/package.json`, `$V type "ckage"`, `$V shot files-package-lift`. Pass when it is first among the substring hits (band 3 lifted to 2) and no prefix or word-start hit sits below it. Undo the records.
- [ ] Lane 6. Open and record. `$V type "claude"`, `$V key enter`, `$V shot files-open-hud` within 1.5 s. Pass when the HUD names `CLAUDE.md`, the launcher hides, and `$V call frecency.get` holds the absolute path with one open. Undo the record.
- [ ] Lane 7. Recent files. After lane 6's open and before its undo, `$V open`, `$V run builtin:search-files`, `$V shot files-recent`. Pass when "Recent & frequent files" lists `CLAUDE.md` first.
- [ ] Lane 8. Stale reply dropped. `$V type "frecenc"` then `$V key backspace` six times within 500 ms, `$V shot files-after-backspace`. Pass when the rows match the one-letter query, the log shows one `files: ranked` line per query in key order, and no stale rows are applied.
- [ ] Lane 9. Back out. `$V key shift+escape`, `$V shot files-popped`. Pass when the root view shows and the query is empty.
- [ ] Lane 10. Keystroke budget. `$V type "s"` then `$V type "p"` with `qs log` open. Save the `$V log 120` output as `keystroke-budget.txt`. Pass when the median `files: ranked` time over at least 20 keystrokes is under 10 ms, none is over 50 ms, and the rows update within 50 ms of each key, read from the log timestamps (amended 2026-11-04: the engine's garbage collector lands inside about 1 search in 10 after root typing, 13 to 37 ms, while every other search is 8 ms or less; a forced collection on push froze the whole shell for 70 ms and was rejected).

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Root keystroke latency, the `rootSearch.search` call time for `firefox` at trunk and head. Trunk lacks the view, so also the diff-added work, the `files: ranked` time per keystroke over the dev machine's list, and the end state the user waits for, which is the rows for the current query visible.
- [ ] Probe. `omacast call rootSearch.search '{"query":"firefox"}'` timed with `date +%s%N`, five runs per side, alternating. On head, `$V type` one letter at a time through `spec` and read the `files: ranked` lines.
- [ ] Baseline. Record trunk's `rootSearch.search` median first.
- [ ] Rule. Head's root median exceeds trunk's by more than 10 ms, fails. A median `files: ranked` time over 10 ms across at least 20 keystrokes, or any single one over 50 ms, fails (amended 2026-11-04 for the same collector pauses, countersigned in the trail). Rows later than 50 ms after a key, fails.

**Review gate.** The operator reviews before merge.
- [ ] Copy lane 3 and lane 7 screenshots into `docs/screenshots/phase7/p7-2-review-oma-spec.png` and `docs/screenshots/phase7/p7-2-review-recent.png`.
- [ ] Record a 30 to 60 second video of pushing the view, typing `oma spec`, opening `CLAUDE.md`, and the recent list on a live lane. Save it as `docs/screenshots/phase7/p7-2-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**
- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## Preview files and act on them (P7-3)
**Depends on.** P7-2.

**Files.**
- [ ] Create `ui/FilePreview.qml`. The detail pane. Image preview for raster and SVG, the first 200 lines of a text file as `Text.PlainText`, the first page of a PDF through `pdftotext` when installed, and a metadata block (size, mtime, directory) for everything else.
- [ ] Create `services/FileActions.qml`. Show in Folder (`xdg-open` on the parent), Open With… (the app list from `shell.appLibrary`, launch with the path as the entry's argument through `gtk-launch`), Copy Path (`wl-copy` on stdin through `ClipboardWriter`), Move to Trash (the freedesktop Trash spec, `~/.local/share/Trash/files` and `info`).
- [ ] Edit `ui/LauncherWindow.qml`. The master-detail layout for the `files` view, the action panel entries with their shortcuts, Quick Look on Ctrl+Y as a larger preview, and the Move to Trash alert.
- [ ] Edit `Backend.qml`. Register `files.preview`, `files.showInFolder`, `files.copyPath`, `files.trash` and `files.openWith`.
- [ ] Create `tests/file-actions.test.js`.

**Build.**
- [ ] `files.preview` reads at most 64 KB of a text file through a `FileView`, never the whole file, and refuses files over 1 MB with a metadata-only pane.
- [ ] Move to Trash writes the `.trashinfo` file before moving, with the original path percent-encoded per the spec, and asks first through the existing `Alert`.
- [ ] Copy Path goes through `services/ClipboardWriter.qml` on stdin.
- [ ] The preview loads only after the selection has been still for 80 ms [I], so arrowing through rows does not read every file.

**You see.**
- [ ] Selecting `README.md` shows its first lines on the right. Selecting a PNG shows the image. Ctrl+K lists Open, Show in Folder, Open With…, Copy Path and Move to Trash with their shortcuts.
- [ ] Ctrl+Y opens the larger preview, Esc closes it.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] `tests/file-actions.test.js` builds a `.trashinfo` body for a path with spaces and a `%` and compares it to the literal expected text, and checks the 1 MB preview cutoff. Run `node --test tests/file-actions.test.js`.
- [ ] `tests/privacy.test.js` passes unchanged, which proves no new `command:` carries user text. Run `node --test tests/privacy.test.js`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the `swarm workers` role in `p3-models.md` at the PR head, per the boot recipe.
- [ ] Lane 1. Regression lane against trunk. At trunk and head, `$V run builtin:search-files`, `$V type "readme"`, time to first rows from `qs log`. Save the `$V log 120` output as `regression-lane-against-trunk.txt`. Pass when head's time is within 10 ms of trunk's and the preview pane does not delay the rows.
- [ ] Lane 2. Text preview. `$V type "claude"`, wait 200 ms, `$V shot preview-text`. Pass when the pane shows the first lines of `CLAUDE.md`.
- [ ] Lane 3. Image preview. `$V type "png"`, `$V shot preview-image`. Pass when the pane shows the image and its dimensions.
- [ ] Lane 4. Large file. Create a 2 MB text file in a temp dir under `$HOME`, refresh, select it, `$V shot preview-large`. Pass when the pane shows metadata only. Delete the file.
- [ ] Lane 5. Copy Path. Select `SPEC.md`, `$V key ctrl+k`, choose Copy Path, `$V shot copy-path-hud`. Pass when `wl-paste -n` prints the absolute path and the HUD says "Copied".
- [ ] Lane 6. Show in Folder. Select `SPEC.md`, choose Show in Folder. Save the `$V log 120` output as `show-in-folder.txt`. Pass when `hyprctl clients -j` gains a window whose title contains `oma-cast` within 2 s. Close it.
- [ ] Lane 7. Move to Trash. Create `~/omacast-trash-test.txt`, refresh, select it, choose Move to Trash, `$V shot trash-alert`, `$V key enter`. Pass when the file is gone, `~/.local/share/Trash/files/omacast-trash-test.txt` exists with a matching `.trashinfo`, and the row disappears. Remove both trash entries.
- [ ] Lane 8. Trash cancelled. Repeat lane 7 up to the alert, `$V key escape`. Save the `$V log 120` output as `trash-cancelled.txt`. Pass when the file is still in place and the row is still listed.
- [ ] Lane 9. Quick Look. Select `CLAUDE.md`, `$V key ctrl+y`, `$V shot quick-look`, `$V key escape`. Pass when the larger preview covers the list and Esc returns to the list with the same selection.
- [ ] Lane 10. No argv leak. During a preview of a file whose name holds a space, `ps -eo args | grep '[p]dftotext\|[w]l-copy'`. Save the `ps` output as `no-argv-leak.txt`. Pass when no process line contains typed query text, only file paths.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Time from a selection change to the preview painted, from the `files: preview` log line, at head. Trunk lacks the pane, so the diff-added work is the preview load and the end state is the painted pane. Also the rows time at trunk and head from lane 1.
- [ ] Probe. Arrow through ten rows with `$V key down` at 200 ms intervals and read ten `files: preview` lines. Repeat at trunk for the rows time only.
- [ ] Baseline. Record trunk's rows time first.
- [ ] Rule. Rows slower than trunk by more than 10 ms, fails. A text or image preview over 100 ms, fails. A PDF preview over 500 ms, fails.

**Review gate.** The operator reviews before merge.
- [ ] Copy lane 2, lane 3 and lane 7 screenshots into `docs/screenshots/phase7/p7-3-review-text.png`, `docs/screenshots/phase7/p7-3-review-image.png` and `docs/screenshots/phase7/p7-3-review-trash.png`.
- [ ] Record a 30 to 60 second video of previews, Copy Path and Move to Trash on a live lane. Save it as `docs/screenshots/phase7/p7-3-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**
- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## Show a Files section in root search (P7-4)
**Depends on.** P7-2.

**Files.**
- [ ] Edit `core/RootSearch.js`. `rootSections` gains a `files` section after Results and before the fallbacks, from `ctx.fileHits`, at most 3 rows, only for a path-like query or a query of at least 3 characters with name matches.
- [ ] Edit `Backend.qml`. `searchAsync` asks `FileRanker` for the root query in the same callback as the flea hits, so one reply carries both.
- [ ] Edit `ui/LauncherWindow.qml`. The file row shape (name, directory subtitle, file icon) and ↵ as Open.
- [ ] Edit `tests/rootsearch.test.js` and `tests/formal/SearchOrdering.tla`, `tests/formal/SearchOrdering.cfg`, `tests/formal/anchors.js`.

**Build.**
- [ ] One `searchAsync` reply holds both the flea hits and the file hits, so the serial guard covers the section with no new async path. The formal model records this as the same message, and `tests/formal/check.sh --safety` passes.
- [ ] A path-like query (`~/`, `/`) skips the 3-character rule and shows the section alone.
- [ ] The section never shows for a query that matches an alias exactly, so aliases keep the top.

**You see.**
- [ ] Typing `spec` at root shows Results, then a Files section with `SPEC.md` and two more rows, then "Use "spec" with…".
- [ ] Typing `~/Pro` shows the Files section only.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] `tests/rootsearch.test.js` gains cases for the section's position, the 3-row cap, the 3-character rule, the path-like rule and the alias rule, each against literal section ids and row ids. Run `node --test tests/rootsearch.test.js`.
- [ ] `tests/formal/check.sh --safety` passes with the model re-synced, and `tests/formal/check.sh --mutants` still proves each property can fail.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the `swarm workers` role in `p3-models.md` at the PR head, per the boot recipe.
- [ ] Lane 1. Regression lane against trunk. At trunk and head, `$V open`, `$V key ctrl+u`, `$V type "firefox"`, `$V shot root-firefox`. Pass when the Results rows are identical on both sides and the Files section on head holds at most 3 rows below them.
- [ ] Lane 2. Section order. `$V type "spec"`, `$V shot root-spec`. Pass when the sections read Results, Files, "Use "spec" with…" top to bottom.
- [ ] Lane 3. Two characters. `$V type "sp"`, `$V shot root-sp`. Pass when no Files section shows.
- [ ] Lane 4. Path-like. `$V type "~/Pro"`, `$V shot root-path`. Pass when only the Files section shows and its first row is under `~/Projects`.
- [ ] Lane 5. Open from root. `$V type "claude"`, `$V key ctrl+2` on the Files row if Results has rows, else `$V key enter`, `$V shot root-open-hud`. Pass when the HUD names `CLAUDE.md` and the launcher hides. Undo the frecency record.
- [ ] Lane 6. Alias keeps the top. Set an alias `spec` on Calculator History, `$V type "spec"`, `$V shot root-alias`. Pass when the alias row is first and no Files section shows. Remove the alias.
- [ ] Lane 7. Stale reply. `$V type "frecenc"` then six `$V key backspace` within 500 ms, `$V shot root-after-backspace`. Pass when the rows belong to `f` and `qs log` shows dropped replies.
- [ ] Lane 8. Hide during search. `$V type "spec"` then `$V hide` within 20 ms, `$V open`. Save the `$V log 120` output as `hide-during-search.txt`. Pass when the rows shown belong to the surviving query and no QML error is logged.
- [ ] Lane 9. Compact mode. With `compact` on, `$V open`, `$V type "spec"`, `$V shot root-compact`. Pass when the Files section appears without breaking the compact layout.
- [ ] Lane 10. Zoom. `$V key ctrl+plus` twice, `$V type "spec"`, `$V shot root-zoomed`, `$V key ctrl+0`. Pass when file rows scale with the others.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Root keystroke latency, the `rootSearch.search` call time and the key-to-rows time for `spec` at trunk and head. Both sides produce it.
- [ ] Probe. `omacast call rootSearch.search '{"query":"spec"}'` timed five times per side, alternating trunk and head, and `$V type` through `spec` one letter at a time with `qs log` timestamps.
- [ ] Baseline. Record trunk's median first.
- [ ] Rule. Head's median exceeds trunk's by more than 10 ms, fails. Key-to-rows over 50 ms on head, fails.

**Review gate.** The operator reviews before merge.
- [ ] Copy lane 2 and lane 4 screenshots into `docs/screenshots/phase7/p7-4-review-section.png` and `docs/screenshots/phase7/p7-4-review-path.png`.
- [ ] Record a 30 to 60 second video of typing `spec`, `~/Pro` and opening a file from root on a live lane. Save it as `docs/screenshots/phase7/p7-4-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**
- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## Reveal content matches when few names match (P7-5)
**Depends on.** P7-3.

**Files.**
- [ ] Create `services/ContentSearch.qml`. Runs `rg --json -F -i -f - --max-filesize 1M --ignore-file <file> <root>` with the query on stdin, collects match objects, kills the process on cancel or at 300 ms, and reports rows `{ path, line, text }`.
- [ ] Edit `core/FileRanker.js`. `revealContent(query, nameHits)` returns true for at least 3 characters and either fewer than 5 hits in bands 0 to 3 or a space. `contentRows(matches, signals)` sorts by the folder prior and caps at 20.
- [ ] Edit `ui/LauncherWindow.qml`. The Contents section below the name rows in the `files` view, the 150 ms stillness timer, the Names / Contents dropdown on Ctrl+P, and the row shape with the matching line as subtitle in `Text.PlainText`.
- [ ] Edit `Backend.qml`. Register `files.searchContents`.
- [ ] Create `tests/content-search.test.js`. Edit `tests/privacy.test.js` and `tests/formal/`.

**Build.**
- [ ] `ContentSearch` writes the query and a newline to stdin then closes it, and never places the query in `command:`.
- [ ] The content request carries the view's search serial. The reply is dropped unless the serial still matches, and the running process is killed on every keystroke, hide and view change. The formal model gains the content source as a second async message with its own cancel, and `check.sh --safety` passes.
- [ ] Rows stay out of the list until the process exits or the 300 ms timer kills it, then appear together sorted by the prior.
- [ ] The Contents dropdown value forces the content search on every query of at least 3 characters and hides the name rows.

**You see.**
- [ ] Typing `frec` in Search Files shows the name rows, then after 150 ms a Contents section with up to 20 rows, each with the matching line.
- [ ] Typing one more letter clears the Contents section until the new reply lands. `qs log` shows `[omacast] content: 22 files in 27 ms` and `content: cancelled` for the earlier query.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] `tests/content-search.test.js` replays the reveal table from `docs/phase7-prototypes/README.md` (`frec` opens, `fre` does not, `zoxide q` opens on the space, `copyright` never opens) and parses a fixture of `rg --json` lines into rows with literal expected text. Run `node --test tests/content-search.test.js`.
- [ ] `tests/privacy.test.js` gains a case that the `rg` command array in `services/ContentSearch.qml` is fixed and that the query goes to `write`. Run `node --test tests/privacy.test.js`.
- [ ] `tests/formal/check.sh --safety` and `--mutants` pass with the second source modelled.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the `swarm workers` role in `p3-models.md` at the PR head, per the boot recipe.
- [ ] Lane 1. Regression lane against trunk. At trunk and head, `$V run builtin:search-files`, `$V type "readme"`, `$V shot files-readme`. Pass when the name rows are identical, no Contents section shows (115 name hits), and head's rows time is within 10 ms of trunk's.
- [ ] Lane 2. Reveal. `$V type "frec"`, wait 400 ms, `$V shot content-frec`. Pass when a Contents section shows with rows whose subtitle contains `frec`, and `qs log` shows the content time under 300 ms.
- [ ] Lane 3. Too short. `$V type "fr"`, wait 400 ms, `$V shot content-fr`. Pass when no Contents section shows.
- [ ] Lane 4. Space opens it. `$V type "zoxide q"`, wait 400 ms, `$V shot content-space`. Pass when the Contents section shows.
- [ ] Lane 5. Cancel on keystroke. `$V type "frec"`, wait 400 ms, `$V type "e"` immediately followed by `$V shot content-cancel` within 100 ms. Pass when the Contents section is empty or belongs to `frece`, and `qs log` shows `content: cancelled`.
- [ ] Lane 6. Stale ↵. `$V type "frec"`, wait 400 ms, `$V key down` to a content row, `$V type "x"`, `$V key enter` within 100 ms. Save the `$V log 120` output as `stale.txt`. Pass when nothing opens (no HUD, no new window in `hyprctl clients -j`) or the opened row belongs to `frecx`.
- [ ] Lane 7. Forced contents. `$V type "copyright"`, `$V key ctrl+p`, choose Contents, `$V shot content-forced`. Pass when up to 20 content rows show and the name rows are hidden.
- [ ] Lane 8. No argv leak. During lane 2, `ps -eo args | grep '[r]g '`. Save `ps-argv.txt`. Pass when the `rg` line holds `--json -F -i -f - --max-filesize 1M --ignore-file <path> <root>` and nothing else.
- [ ] Lane 9. Hide kills it. `$V type "frec"`, `$V hide` within 50 ms. Save the `$V log 120` output as `hide-kills-it.txt`. Pass when `pgrep -f 'rg --json'` is empty 200 ms later and `qs log` shows `content: cancelled`.
- [ ] Lane 10. Open a content row. `$V type "searchmatch"`, wait 400 ms, `$V key down` to the first content row, `$V key enter`, `$V shot content-open-hud`. Pass when the HUD names the file and the frecency record holds its path. Undo the record.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. The name rows time for `readme` at trunk and head. Trunk lacks content search, so also the diff-added work, the `content:` time for `frec` warm and after `docs/phase7-prototypes/evict.py`, and the end state the user waits for, the Contents section painted.
- [ ] Probe. Five interleaved runs per side for the rows time. On head, five `frec` runs warm and five after eviction, reading the `content:` log line.
- [ ] Baseline. Record trunk's rows time first. The prototype measured the search itself at 24 to 25 ms warm and 148 to 156 ms content-cold.
- [ ] Rule. Rows slower than trunk by more than 10 ms, fails. A warm `content:` time over 100 ms, fails. A content-cold time over 300 ms, fails. The Contents section painted later than 450 ms after the last key warm, fails.

**Review gate.** The operator reviews before merge.
- [ ] Copy lane 2 and lane 7 screenshots into `docs/screenshots/phase7/p7-5-review-reveal.png` and `docs/screenshots/phase7/p7-5-review-forced.png`.
- [ ] Record a 30 to 60 second video of `frec` revealing content, a keystroke cancelling it, and the Contents dropdown on a live lane. Save it as `docs/screenshots/phase7/p7-5-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**
- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## Read Neovim's file marks as a usage signal (P7-6)
**Depends on.** P7-2.

**Files.**
- [ ] Create `core/Shada.js`. A msgpack reader for the shada entry types 7 (file mark), 8 (jump) and 9 (buffer list), returning `{ path, timestamp }` rows and nothing else.
- [ ] Edit `services/UsageSignals.qml`. Read `~/.local/state/nvim/shada/main.shada` through a `FileView` on refresh when it exists, and add each row as an open at its timestamp.
- [ ] Create `tests/shada.test.js` with a fixture file written by `nvim --headless` during the PR.

**Build.**
- [ ] `Shada.read(bytes)` stops at the first malformed entry and returns the rows read so far, so a corrupt file costs nothing.
- [ ] Shada opens count as usage with the same decay as omacast opens but never lift a band. Only omacast opens lift.

**You see.**
- [ ] After opening `~/Projects/oma-cast/core/Ranker.js` in Neovim and quitting, "Recent & frequent files" lists it, and `qs log` shows `[omacast] signals: shada 1 rows in 2 ms`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] `tests/shada.test.js` parses the fixture and expects the literal paths and timestamps, and parses a truncated copy without throwing. Run `node --test tests/shada.test.js`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the `swarm workers` role in `p3-models.md` at the PR head, per the boot recipe.
- [ ] Lane 1. Regression lane against trunk. At trunk and head, `$V run builtin:search-files`, `$V shot files-recent`. Trunk lists only omacast opens. Pass when head lists the same rows plus the Neovim rows below them when omacast opens exist, and the rows time is within 10 ms of trunk's.
- [ ] Lane 2. A new mark. `nvim --headless +'e ~/Projects/oma-cast/core/Ranker.js' +wshada +q`, `$V open`, `$V run builtin:search-files`, `$V shot shada-recent`. Pass when `Ranker.js` is listed.
- [ ] Lane 3. No lift. Open `~/Dev/sales-crm/README.md` in Neovim ten times, `$V type "readme"`, `$V shot shada-no-lift`. Pass when it ranks inside its band by usage and does not jump a band.
- [ ] Lane 4. Missing file. Move `main.shada` aside, `$V launch`. Save the `$V log 120` output as `missing-file.txt`. Pass when `qs log` shows `signals: shada absent` and no QML error. Restore it.
- [ ] Lane 5. Corrupt file. Truncate a copy of `main.shada` to 100 bytes, point the service at it through `$V call files.refresh`, `$V shot shada-corrupt`. Pass when the launcher works and the log shows the rows read before the cut.
- [ ] Lane 6. Large file. Write a 2 MB shada with `nvim --headless` over a loop of 5,000 files. Save the `$V log 120` output as `large-file.txt`. Pass when `signals: shada` reports under 50 ms.
- [ ] Lane 7. Private paths. Mark `~/.ssh/config` in Neovim. Save the `$V log 120` output as `private-paths.txt`. Pass when it never appears in "Recent & frequent files" because the private-path filter applies to signals too.
- [ ] Lane 8. Refresh cadence. Mark a file, `$V open` within 30 s. Save the `$V log 120` output as `refresh-cadence.txt`. Pass when the row appears only after the next refresh, per the 30 s rule.
- [ ] Lane 9. Argv. `ps -eo args | grep '[n]vim'` during a refresh. Save the `ps` output as `argv.txt`. Pass when omacast spawned no nvim process, since the file is read directly.
- [ ] Lane 10. Doctor. `omacast doctor`. Save the `omacast doctor` output as `doctor.txt`. Pass when it prints the shada path, its size and the row count.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. The refresh time from `files: listed` at trunk and head. Trunk lacks the signal, so also the diff-added work, the `signals: shada` time, and the end state, the recent list painted after a refresh.
- [ ] Probe. Five refreshes per side, alternating, reading both log lines.
- [ ] Baseline. Record trunk's refresh median first.
- [ ] Rule. Head's refresh exceeds trunk's by more than 20 ms, fails. `signals: shada` over 50 ms on the 2 MB file, fails.

**Review gate.** None. P7-6 is not review-gated.

**Merge.**
- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## Close the program
- [ ] Every box above is checked with its evidence.
- [ ] Update the Status section of `CLAUDE.md` with what works, what is stubbed and the deviations.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence
The prototypes ran on 2026-11-04 on the dev machine from the scratch directory and were copied into `docs/phase7-prototypes/` with their results in that directory's `README.md`. They are not on a branch of their own. The working tree at the time was `verify-skills-file-search-spec` at `4aa76dc` plus this plan.

- Large-subtree threshold. Settled. 5,000 flags `~/Applications/UnrealEngine` and `~/node_modules` only. 2,000 also flags two of the user's own trees. `detect.py`.
- Ranking bands and the lift. Settled. Bounded lift on the file's own opens, never into exact or prefix, ranks the 13-query set as intended except the arguable `readme` and `sales readme` cases. The unbounded blend fails `spec` and `launch`. Lifting on the folder prior fails `skill`. `rank.js`.
- Content-reveal gate. Settled. Fewer than 5 substring name hits or a space, at 3 characters or more. Subsequence counting would delay `frecency` by three keystrokes. `reveal.js`.
- Warm and content-cold search timing. Settled. 24 to 25 ms warm, 148 to 156 ms with file pages evicted, bound by the walk and the file opens, not by matching. `content.sh`, `evict.py`.
- Matcher in Qt's JS engine. Settled. A character loop costs 45 to 52 ms per keystroke over 14,949 names, a per-name `RegExp` 1 to 4 ms. `v4.qml`, `v4re.qml`.
- Disk-cold listing. Settled as a floor, without root. The listed tree copied into a btrfs image, mounted through udisks and evicted between rounds, lists in 36 to 74 ms cold (median 45, 1,142 reads) and the full home in 632 to 738 ms cold (12,407 reads), five rounds each, bound by 39 to 52 µs per read through the loop device. The fragmented real home needs more reads, so P7-1 records the first listing after a reboot. `cold-loop.sh`, with `cold.sh` for an operator with root.
- Neovim shada signal. Unproven. The dev machine's file is 267 bytes. P7-6 is last and may be dropped.

## Appendix B. Alternatives rejected
- A persistent index (Raycast's design). The listing without vendor trees takes 11 to 13 ms warm and the content search 24 to 25 ms, so an index saves nothing a user can feel and adds a cache file, an inotify watcher and a staleness bug class. It returns only on the measured triggers in `SPEC.md §8.6`.
- `fzf`, `nucleo` or `fuse.js` for file names. Rule 5 in `CLAUDE.md` forbids them for root search, and the band ranker needs band membership, which a single fuzzy score hides.
- Keeping large untouched subtrees in the list on a reduced band. 300,000 names would take the regex matcher to about 60 ms per keystroke and would not fit the helper's 20,000-entry catalog. Leaving them out with a toast is cheaper and clearer.
- One blended score with unbounded usage. It let a heavily opened subsequence match beat prefix matches and a heavily opened prefix match beat the exact match. The band order is what the user predicts.
- A character-loop matcher in QML. 25 times slower than node in Qt's engine. Native regexes do the same bands in 1 to 4 ms.
- Streaming content rows in folder-tree order. The whole run finishes in 25 ms warm and 150 ms content-cold, so rows can be collected and sorted once. Streaming would add a protocol for no visible gain.
- The Rust helper as the primary file matcher. It is gitignored, needs cargo, and marketplace users may never build it. The QML regex path serves everyone at this scale. A helper file catalog is the next step past 50,000 files.
- Access times, the GTK recent list, inotify open events and fanotify as usage signals. Each is useless or unavailable on Omarchy, as `SPEC.md §8.6` records.

## Appendix C. Risks
- One shared shell instance. Live lanes cannot run in parallel. P7-1 through P7-6. The root serialises the live lanes and the owner never drives the launcher while the operator types.
- The cold listing was measured on a fresh copy, not on the fragmented real home. P7-1. The floor is 36 to 74 ms against a 1 s trigger, so the owner records the real home's first listing after a reboot and stops the program only if it exceeds 1 s.
- The vendor trees change. The spec was written against three Unreal copies in `$HOME` and this plan against one under `~/Applications`. P7-1. The owner reruns `detect.py` at the head and records the current trees in the PR body.
- The 20,000-entry helper catalog. P7-2 does not use the helper for files, so the file list has no cap but the keystroke budget. P7-2's perf block watches the `files: ranked` time and the owner files the helper catalog as a follow-up if the list passes 50,000.
- `rg --json` output size. A query with thousands of matches produces many megabytes before the 300 ms kill. P7-5. `--max-count 1` per file and the kill timer bound it, and lane 7 checks the forced `copyright` case.
- Move to Trash on btrfs subvolumes and other mounts. P7-3. The owner tests a file on a second mount if one exists, otherwise records the gap.
- The shada signal may stay empty on the dev machine. P7-6. The owner writes the fixture with `nvim --headless` and the PR may be dropped.
- `p3-models.md` is absent. All PRs. The root runs `setup-p3` before spawning.
- The fork is not synced with Graphite, so `gt submit` refuses it. All PRs. The owner opens the PR with `gh` on the `gt` branch per the PR mechanics until the operator syncs the fork, and the stack shape is unchanged either way.
- The formal model drifts. P7-4 and P7-5 add messages to `SearchOrdering.tla`. `check.sh` exits 3 on an unsynced anchor and the owner re-syncs before claiming a pass.

## Appendix D. Links and reading list
- `SPEC.md §8.6` for every decision and its evidence. `SPEC.md §12` Phase 7 for the acceptance checks. `SPEC.md §0` rules 5 and 6.
- `docs/phase7-prototypes/README.md` for the numbers, with the scripts beside it. `cold-loop.sh` reruns the cold measurement without root.
- `.agents/skills/verify-omacast/SKILL.md`, the control skill for every live lane. `.agents/skills/verify-search-ordering/SKILL.md` for P7-4 and P7-5.
- `services/NativeSearch.qml`, `Backend.qml` `searchAsync` and `ui/LauncherWindow.qml` `rebuild` for the serial guard that the file and content sources reuse.
- `core/Frecency.js` and `core/RootSearch.js` for the usage formula and the section builder.
- P7-2 and P7-5 get `skills/how/SKILL.md` before implementation. P7-2's band weights and P7-5's reveal rule get `skills/interrogate/SKILL.md` if an owner proposes changing them.
- The decision trail per `skills/show-me-your-work/SKILL.md` lives in `docs/phase7-trail.md`, committed with each PR.
