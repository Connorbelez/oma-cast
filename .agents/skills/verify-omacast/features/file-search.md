# File search

omacast keeps a list of the user's files in memory, built with `rg --files` over the home dir and `~/.config` (with hidden files). A daily full count finds large untouched subtrees, directories over 5,000 files with no zoxide entry or active git repo inside, and leaves their files out of the list. P7-1 ships the list, the detection, the ignore file, the `files.*` RPCs and the doctor lines. Ranking, the Search Files view and content results come in later PRs.

## Sub-features

- `files-list` the in-memory list. It is built when the plugin loads, after the first recount, in 65 to 152 ms on the dev machine with the cache present (four reloads). It is refreshed 250 ms after an open once it is older than 30 s, and never while a refresh is running; a refresh requested during one runs right after it. Each listing logs `[omacast] [info] files: listed <n> paths in <ms> ms`. The previous list stays when either rg run exits with anything but 0 or is killed (`files: rg exited <code> for <root>; keeping the previous list`, with `abnormally` for a signal), and when a refresh takes over 15 s (`files: refresh timed out`).
- `files-ignore-file` `~/.config/omacast/file-search.ignore`, created with the build dirs and the private paths on first start, mode 0600. Patterns with a slash are relative to the home dir. rg lists everything when an ignore file is missing, so no listing runs without both files. A refresh that finds one missing or unreadable logs `files: an ignore file is missing; recreating it`, recreates it, and lists again. If it is still unreadable, it logs `files: ignore file missing, keeping the previous list`. A line rg cannot parse is logged once (`files: rg cannot read the ignore line …`) and matches nothing.
- `files-large-subtrees` the daily recount, one `rg --files ~ | awk` process outside the shell (`files: counted <n> paths, <k> large untouched subtrees in <ms> ms`, 616 to 745 ms on the dev machine). It runs at load when the cached result in `~/.cache/omacast/file-search.json` is a day old or missing, and on hide when one is due. It gives up after 60 s (`files: recount timed out`). Detected trees go into `~/.cache/omacast/file-search-untouched.ignore`, so the list leaves them out whether or not the user accepts the toast. That file is also recreated from the last recount when it goes missing.
- `files-toast` `files.takeToast` returns "Skipping ~/Applications/UnrealEngine (300,136 files)" once per tree (the footer shows about 52 characters, so the title carries no question; the Ctrl+T action does), records `fileSearch.askedAt[path]` in `db/settings.json`, and offers it again after 7 days. `prepare()` in `ui/LauncherWindow.qml` calls it on every open and shows the result in the footer for 6 s. Ctrl+T opens the toast's action "Add to Ignore File", which calls `files.ignore`.
- `files-rpc` `files.list` (count, roots, timing, paths in pages of at most 1,000, optional `under`), `files.refresh` (optional `roots`), `files.largeSubtrees`, `files.ignore` (append one path under the home dir).
- `files-doctor` `omacast doctor` prints the count, both roots, the ignore file and each large subtree.

## How to get to it (user POV)

- Run `omacast doctor`.
- Run `omacast call files.list '{"limit":0}'`, `omacast call files.largeSubtrees '{}'`.
- The toast in the launcher footer on the first open after a tree is detected, and Ctrl+T then ↵ to accept it.

## Driving it with omacast-verify

Preconditions:

- The baseline from the README holds.
- Save `~/.config/omacast/file-search.ignore` and `jq .fileSearch ~/.local/share/omacast/db/settings.json` first, to restore them at the end.

- **List.** Run `$V open`, then `$V call files.list '{"limit":0}' | jq .data.count` within 100 ms. The count is about 20,000 on the dev machine (14,956 from the home dir and 4,939 from `~/.config`). `$V log 120` has a `files: listed` line under 50 ms for a warm refresh.
- **Hidden config root.** `$V call files.list '{"under":"'$HOME'/.config/hypr","limit":1000}'` holds `~/.config/hypr/hyprland.lua`. Page through `files.list` with `offset` and check that no path sits under `~/.config/chromium`, `~/.config/zen`, `~/.ssh` or a `Cache/` dir.
- **Large subtrees.** `$V call files.largeSubtrees '{}'` lists `~/Applications/UnrealEngine` (300,136) and `~/node_modules` (12,558, `ignored: true` because the default ignore file has `node_modules/`), and not `~/Dev`.
- **Failure keeps the list.** `$V call files.refresh '{"roots":["/nonexistent"]}'`, wait 1 s, then `files.list`. The count and roots are unchanged, and the log has one `files: rg exited 2 for /nonexistent; keeping the previous list`.
- **Missing ignore file.** Copy `~/.config/omacast/file-search.ignore` aside, delete it, `$V call files.refresh '{}'`, wait 2 s. The count is unchanged, `files.list '{"under":"'$HOME'/.config/chromium","limit":0}'` has `matched: 0`, the file is back at mode 0600 with the defaults, and the log has `files: an ignore file is missing; recreating it`. The same holds for `~/.cache/omacast/file-search-untouched.ignore`.
- **Hung rg.** `mkdir ~/omacast-hang && mkfifo ~/omacast-hang/.ignore`, then `$V call files.refresh '{}'`. rg blocks opening the FIFO, `files.list` reports `refreshing: true`, and after 15 s the log has `files: refresh timed out` and `refreshing` is false. Free and remove it with `bash -c 'exec 3<>"$1"; : >"$1.new"; mv -f -- "$1.new" "$1"; exec 3>&-' _ ~/omacast-hang/.ignore; rm -rf ~/omacast-hang` right away, because every rg and fd that walks the home dir blocks on it.
- **Toast and accept.** `$V call files.takeToast '{}'` returns the toast with a `files.ignore` action, and a second call returns `null`. `$V call files.ignore '{"path":"'$HOME'/Applications/UnrealEngine"}'` appends `/Applications/UnrealEngine/` to the ignore file, which stays 0600, and a second call returns `added: false`.
- **Argv.** A refresh lasts about 25 ms, too short to catch with `ps`; hold it with the FIFO above (one under `~` and one under `~/.config`). `ps -eo args | grep '[r]g '` then shows only `rg --files [--hidden] --ignore-file ~/.config/omacast/file-search.ignore --ignore-file ~/.cache/omacast/file-search-untouched.ignore <root>`. During a recount it shows `rg --files <home>`, `awk -F/ -v threshold=5000 <constant program>` and `fd … --exclude node_modules <home>`.
- **Doctor.** `bin/omacast doctor` prints `file search lists … files from <home> and <home>/.config`, the ignore file, and one `left out, large and untouched` line per tree.
- **Restore.** Put back the saved ignore file and `fileSearch` in `db/settings.json`.

## Gotchas

- ↵ while the toast shows activates the selected row, not the toast. Accepting the toast is Ctrl+T then ↵, like every toast action in the launcher. The toast leaves the footer after 6 s and does not return for 7 days, because taking it records the ask.
- `files.takeToast` records the ask. Calling it from a test hides the toast from the next real open for 7 days, so restore `fileSearch.askedAt`.
- `qs ipc` drops replies over about 200 KB. `files.list` returns 100 paths by default and at most 1,000 per call.
- rg anchors `--ignore-file` patterns at its working directory. Every run starts in the home dir, and a hand-run check must too (`cd ~`).
- The first recount on a fresh install walks all of `$HOME` (327,662 files on the dev machine) in about 0.75 s, and the first list waits for it.
- A FIFO under the home dir blocks rg, fd and the recount until something opens it for writing. Remove the hung-rg test dir as soon as the timeout shows.
