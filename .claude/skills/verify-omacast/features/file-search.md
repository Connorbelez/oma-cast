# File search

omacast keeps a list of the user's files in memory, built with `rg --files` over the home dir and `~/.config` (with hidden files). A daily full count finds large untouched subtrees, directories over 5,000 files with no zoxide entry or active git repo inside, and leaves their files out of the list. P7-1 ships the list, the detection, the ignore file, the `files.*` RPCs and the doctor lines. Ranking, the Search Files view and content results come in later PRs.

## Sub-features

- `files-list` the in-memory list. It is built when the plugin loads, refreshed on open once it is older than 30 s, and kept as it was when rg fails. Each listing logs `[omacast] [info] files: listed <n> paths in <ms> ms`.
- `files-ignore-file` `~/.config/omacast/file-search.ignore`, created with the build dirs and the private paths on first start, mode 0600. Patterns with a slash are relative to the home dir.
- `files-large-subtrees` the daily recount (`files: counted <n> paths, <k> large untouched subtrees in <ms> ms`). It runs at load when the cached result in `~/.cache/omacast/file-search.json` is a day old, and otherwise on hide. Detected trees go into `~/.cache/omacast/file-search-untouched.ignore`, so the list leaves them out whether or not the user accepts the toast.
- `files-toast` `files.takeToast` returns "Skipping ~/Applications/UnrealEngine (300,136 files, untouched). Add to ignore file?" once per tree, records `fileSearch.askedAt[path]` in `db/settings.json`, and offers it again after 7 days. Its action calls `files.ignore`. The launcher does not call it yet (see Gotchas).
- `files-rpc` `files.list` (count, roots, timing, paths in pages of at most 1,000, optional `under`), `files.refresh` (optional `roots`), `files.largeSubtrees`, `files.ignore` (append one path under the home dir).
- `files-doctor` `omacast doctor` prints the count, both roots, the ignore file and each large subtree.

## How to get to it (user POV)

- Run `omacast doctor`.
- Run `omacast call files.list '{"limit":0}'`, `omacast call files.largeSubtrees '{}'`.
- The toast in the launcher footer, once the launcher calls `files.takeToast` on open.

## Driving it with omacast-verify

Preconditions:

- The baseline from the README holds.
- Save `~/.config/omacast/file-search.ignore` and `jq .fileSearch ~/.local/share/omacast/db/settings.json` first, to restore them at the end.

- **List.** Run `$V open`, then `$V call files.list '{"limit":0}' | jq .data.count` within 100 ms. The count is about 20,000 on the dev machine (14,956 from the home dir and 4,939 from `~/.config`). `$V log 120` has a `files: listed` line under 50 ms for a warm refresh.
- **Hidden config root.** `$V call files.list '{"under":"'$HOME'/.config/hypr","limit":1000}'` holds `~/.config/hypr/hyprland.lua`. Page through `files.list` with `offset` and check that no path sits under `~/.config/chromium`, `~/.config/zen`, `~/.ssh` or a `Cache/` dir.
- **Large subtrees.** `$V call files.largeSubtrees '{}'` lists `~/Applications/UnrealEngine` (300,136) and `~/node_modules` (12,558, `ignored: true` because the default ignore file has `node_modules/`), and not `~/Dev`.
- **Failure keeps the list.** `$V call files.refresh '{"roots":["/nonexistent"]}'`, wait 1 s, then `files.list`. The count and roots are unchanged, and the log has one `files: rg exited 2 for /nonexistent; keeping the previous list`.
- **Toast and accept.** `$V call files.takeToast '{}'` returns the toast with a `files.ignore` action, and a second call returns `null`. `$V call files.ignore '{"path":"'$HOME'/Applications/UnrealEngine"}'` appends `/Applications/UnrealEngine/` to the ignore file, which stays 0600, and a second call returns `added: false`.
- **Argv.** During `$V call files.refresh '{}'`, `ps -eo args | grep '[r]g '` shows only `rg --files [--hidden] --ignore-file <omacast ignore file>… <root>`.
- **Doctor.** `bin/omacast doctor` prints `file search lists … files from <home> and <home>/.config`, the ignore file, and one `left out, large and untouched` line per tree.
- **Restore.** Put back the saved ignore file and `fileSearch` in `db/settings.json`.

## Gotchas

- The launcher has no Backend-to-toast path. Until `ui/LauncherWindow.qml` `prepare()` calls `files.takeToast` and passes the result to `showToast`, the toast never shows on screen, and ↵ on it means Ctrl+T then ↵ through the toast-action panel.
- `files.takeToast` records the ask. Calling it from a test hides the toast from the next real open for 7 days, so restore `fileSearch.askedAt`.
- `qs ipc` drops replies over about 200 KB. `files.list` returns 100 paths by default and at most 1,000 per call.
- rg anchors `--ignore-file` patterns at its working directory. Every run starts in the home dir, and a hand-run check must too (`cd ~`).
- The first recount on a fresh install walks all of `$HOME` (about 330k files on the dev machine) and takes about 1 s in the worker before the first list appears.
