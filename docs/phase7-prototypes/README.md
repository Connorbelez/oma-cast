# Phase 7 prototypes

Throwaway scripts that settled the file-search decisions in `SPEC.md §8.6` on 2026-11-04. They are evidence, not product code. Each one reruns on the dev machine from this directory. Paths and the synthetic usage in `rank.js` belong to that machine.

Machine at the time of the runs. Omarchy 4.x, Hyprland 0.56, ripgrep 15.2.0, 24 cores, Micron 2500 NVMe, btrfs, load average 0.5 to 1.2, 1 h 21 min after boot.

## Working list

```sh
rg --files ~ > all.txt                     # 327,643 files in 196 ms warm
python3 -I detect.py all.txt 5000 work.txt # large untouched subtrees at the 5,000 threshold, then the list without them
xargs -d '\n' stat -c '%Y %s %n' < work.txt > mtimes.txt
```

`detect.py` walks the tree top down. A directory is a large untouched subtree when it holds more than the threshold and no usage signal (a zoxide entry or a git repo whose `HEAD` reflog changed in 14 days) sits inside it. The walk never descends into one.

| Threshold | Flagged |
|---|---|
| 10,000 and 5,000 | `~/Applications/UnrealEngine` (300,136), `~/node_modules` (12,558) |
| 2,000 | those two plus `~/Dev/wt` (4,952) and `~/Applications/openrgb-ms1603-src` (2,326), both the user's own trees |
| 1,000 | those four plus `~/Work/cms-crm/wt-operator-base-urls` (1,401), an active project |

`~/Dev` (6,774 files) survives every threshold because zoxide lists `~/Dev/sales-crm`. The working list holds 14,949 files.

## Ranking bands (`rank.js`)

```sh
node rank.js
```

Thirteen queries with an intended target, three policies. A is strict bands with usage only inside a band. B is bounded lift. One direct open of the file from omacast (frecency at least 100) moves it up one band, never into exact or prefix. C is one blended score where a band is worth 0.8 and usage is unbounded. Real signals are the zoxide list, four active git repos and every file's mtime. Synthetic omacast opens mark `Dev/sales-crm/package.json` and `p3-stack/skills/how/SKILL.md` as opened twice, a `Spec*` prefix match as opened fifty times, and an `EpicGamesLauncher` subsequence match as opened twenty times.

| Query | Hits | A | B | C |
|---|---|---|---|---|
| `spec` | 688 | 1 | 1 | 2 (`SpectrumCycling.ui` beats the exact `SPEC.md`) |
| `oma spec` | 1 | 1 | 1 | 1 |
| `claude` | 24 | 1 | 1 | 1 |
| `readme` | 115 | 2 | 2 | 2 (the twice-opened project's README wins, which is arguable) |
| `launcher` | 7 | 1 | 1 | 2 |
| `rootsearch` | 4 | 1 | 1 | 1 |
| `package json` | 82 | 1 | 1 | 1 |
| `package` | 68 | 1 | 1 | 1 |
| `skill` | 77 | 1 | 1 | 1 |
| `sales readme` | 15 | 5 | 5 | 2 |
| `app tsx` | 1,364 | 1 | 1 | 1 |
| `launch` | 16 | 1 | 1 | 2 (`EpicGamesLauncher…AppImage`, a subsequence hit, beats the prefix hits) |
| `cms users` | 22 | 1 | 1 | 1 |

Each query ranks 14,949 files in 7 to 16 ms under node.

Two earlier rules failed and were replaced. Lifting on the folder prior (any usage above 1.0) let an untouched `skill-*.md` in the active project beat the twice-opened `SKILL.md`. Letting the lift reach band 0 let the fifty-times-opened prefix match beat the exact match. Matching path segments by subsequence put `sales` on `wagertech-cms-v2-migration`.

`sales readme` stays at rank 5 under A and B because `…-salesforce-missing-lead-fix-readme.md` carries both words as word starts, a band-2 name match that outranks the path band. The name-first rule is kept on purpose.

## Content reveal (`reveal.js`)

```sh
node reveal.js
```

For each prefix of eight typed queries, the number of name hits by subsequence, the number by substring, the number of files whose contents match, and the time of the content search. The gate shows content rows when the query has at least 3 characters and either fewer than 5 substring name hits or a space.

| Query | Content rows appear at | Substring hits then | Subsequence hits then |
|---|---|---|---|
| `frecency` | `frec` (50 files) | 2 | 318 |
| `omacast` | `omac` (38) | 1 | 327 |
| `hyprland` | `hypr` (21) | 2 | 98 |
| `searchmatch` | `searchm` (8) | 1 | 10 |
| `zoxide query` | `zox` (26) | 0 | 4 |
| `Alt+Space` | `alt+` (6) | 0 | 0 |
| `copyright` | never (63 substring hits) | | |
| `wagertech` | never (117) | | |

Counting subsequence hits instead would hold `frecency` back until `frecenc`. Every content search took 23 to 31 ms warm whatever the query, so the time budget never decides.

## Content search timing (`content.sh`, `evict.py`)

```sh
./content.sh
```

`rg --files` with `ignore.txt`, 10 runs, 11 to 13 ms for 14,939 files. Content search `rg -l -F -i -f -` with the query on stdin and `--max-filesize 1M`, 5 interleaved rounds for 10 queries, median 24 to 25 ms, range 23 to 27 ms except one 156 ms outlier on the first run. The time does not depend on the match count (1 to 1,045 files), so the walk and the file opens bound it, not matching.

Content-cold. `evict.py` drops every working file's pages with `posix_fadvise(DONTNEED)`, directory entries stay warm. 3 rounds for 4 queries, cold 148 to 156 ms, the warm rerun 23 to 27 ms. The NVMe reads of 15k small files bound the cold number.

## Disk-cold listing (`cold-loop.sh`, `cold.sh`)

Dropping the directory cache needs root and this machine's sudo rules allow only three Omarchy commands, so `cold-loop.sh` measures a copy instead. It stages every path in `all.txt` as an empty file and every working-list file of 1 MB or less with its contents (14,875 files, 277 MB), writes them into a btrfs image with `mkfs.btrfs --rootdir`, attaches and mounts the image through `udisksctl` as the user, and before each cold run detaches it and drops the image's pages with `posix_fadvise`. `fincore` confirms 0 resident bytes before every cold run. The work directory must sit on the real disk, because `/tmp` is tmpfs.

```sh
W=~/.cache/omacast-cold; mkdir -p $W; cp all.txt work.txt $W/
ROUNDS=5 ./cold-loop.sh $W     # about three minutes the first time, for the 1.4 GB image
```

Five rounds on 2026-11-04, load 0.4.

| Run | Cold | Warm | Reads in the cold run |
|---|---|---|---|
| Listing with `ignore.txt`, 14,951 files | 36 to 74 ms, median 45 | 10 to 12 ms | 1,142 reads, 18.7 MB |
| Content search for `frecency`, 28 hits | 593 to 643 ms | 22 to 24 ms | 11,570 reads, 280 MB |
| Full-home listing, 327,655 files | 632 to 738 ms, median 662 | 166 to 174 ms | 12,407 reads, 203 MB |

Every cold run cost 39 to 52 µs per read whatever the workload, so the loop device's read path bounds the numbers, not CPU. The warm reruns show the CPU share. Two corrections apply when reading them for the real home. The copy is a fresh, compact btrfs, and the real home's metadata is more fragmented, so the real cold listing needs more reads and the copy is a floor. The loop device serialises reads that the NVMe serves to ripgrep's threads in parallel, which is why the content search here takes 600 ms against the 148 to 156 ms that `evict.py` measured on the real files. The real-home content number stands.

`cold.sh` is the direct measurement for an operator with root. It prints the same four numbers plus the full-home listing after `sudo sysctl -w vm.drop_caches=3`.

## Matcher speed in Qt's JS engine (`v4.qml`, `v4re.qml`)

```sh
node -e 'const fs=require("fs");fs.writeFileSync("names.js","var NAMES="+JSON.stringify(fs.readFileSync("work.txt","utf8").trim().split("\n").map(p=>p.slice(p.lastIndexOf("/")+1).toLowerCase())))'
QT_FORCE_STDERR_LOGGING=1 QT_QPA_PLATFORM=offscreen qml6 v4.qml 2>&1 | grep V4
QT_FORCE_STDERR_LOGGING=1 QT_QPA_PLATFORM=offscreen qml6 v4re.qml 2>&1 | grep V4re
```

`qml6` prints nothing without `QT_FORCE_STDERR_LOGGING=1`. The character-loop matcher takes 45 to 52 ms per query over 14,949 names in Qt 6.12's engine against 1 to 6 ms under node. The same bands through one `RegExp` per name take 1 to 4 ms, and one regex scan over the names joined with newlines takes 1 to 3 ms (11 to 14 ms for the one-letter query `s`). The QML fallback therefore matches with native regexes and never with a character loop.
