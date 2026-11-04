#!/bin/bash
# Times rg content search over the working set. Query goes on stdin (-f -), never argv.
cd ~
IG=$(dirname "$(readlink -f "$0")")/ignore.txt
ms() { local s=$(date +%s%N); "$@" >/dev/null; echo $(( ($(date +%s%N)-s)/1000000 )); }
run() { printf '%s\n' "$1" | rg -l -F -i -f - --max-filesize 1M --ignore-file "$IG" . ; }
echo "== rg --files with ignore file, 10 runs (ms)"; for i in $(seq 10); do ms rg --files --ignore-file "$IG" . ; done | sort -n | tr '\n' ' '; echo; rg --files --ignore-file "$IG" . | wc -l
echo "== warm content search, 5 rounds interleaved: query matches median[min-max] ms"
Q=("frecency" "omacast" "wagertech" "zoxide" "hyprland" "searchmatch" "import React" "TODO" "copyright" "Alt+Space")
declare -A T
for r in 1 2 3 4 5; do for q in "${Q[@]}"; do T[$q]+="$(ms run "$q") "; done; done
for q in "${Q[@]}"; do m=$(run "$q" | wc -l); s=$(echo ${T[$q]} | tr ' ' '\n' | sort -n); printf '%-14s %5d  %s [%s-%s]\n' "$q" "$m" "$(echo "$s" | sed -n 3p)" "$(echo "$s" | head -1)" "$(echo "$s" | tail -1)"; done
echo "== content-cold (file pages evicted with fadvise; dentries warm): cold ms then warm ms, 3 rounds"
for q in "frecency" "TODO" "import React" "copyright"; do for r in 1 2 3; do python3 -I $(dirname "$(readlink -f "$0")")/evict.py $(dirname "$(readlink -f "$0")")/work.txt 2>/dev/null; c=$(ms run "$q"); w=$(ms run "$q"); printf '%-14s cold %4d  warm %4d\n' "$q" $c $w; done; done
