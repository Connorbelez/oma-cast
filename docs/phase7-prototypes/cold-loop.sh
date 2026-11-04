#!/bin/bash
# Disk-cold timing without root. cold.sh needs `sysctl vm.drop_caches`, which this machine's sudo rules
# refuse. This script rebuilds $HOME's listed tree inside a btrfs image (every path in all.txt as an empty
# file, every working-list file of 1 MB or less copied in full), attaches and mounts it through udisks as
# the user, and between rounds detaches it and drops the image's pages with posix_fadvise. Each cold run
# then reads the directory tree and the file contents from the NVMe through the loop device. The copy is a
# freshly written, compact btrfs, so its numbers are a floor for the fragmented real home.
#
# Usage: ROUNDS=5 ./cold-loop.sh <workdir>
#   workdir sits on the real disk (not tmpfs) and holds all.txt and work.txt from README.md.
set -euo pipefail
W=$(readlink -f "${1:?workdir}"); P=$(dirname "$(readlink -f "$0")"); IG=$P/ignore.txt
ROUNDS=${ROUNDS:-5}
cd "$W"

if [ ! -f tree.img ]; then
  echo "staging $(wc -l < all.txt) empty files and the working-list files of 1 MB or less" >&2
  rm -rf stage && mkdir stage
  sed "s|^$HOME/||" all.txt > rel-all.txt
  sed "s|^$HOME/||" work.txt > rel-work.txt
  awk -F/ 'NF>1{NF--; print}' OFS=/ rel-all.txt | sort -u | (cd stage && xargs -d '\n' mkdir -p)
  (cd stage && xargs -d '\n' touch < ../rel-all.txt)
  (cd "$HOME" && xargs -d '\n' stat -c '%s %n' < "$W/rel-work.txt" | awk '$1<=1048576{sub(/^[0-9]+ /,""); print}' \
    | xargs -d '\n' cp --parents --preserve=timestamps -t "$W/stage")
  echo "copied $(find stage -type f -size +0 | wc -l) files with contents" >&2
  truncate -s 6G tree.img
  mkfs.btrfs -q -f --rootdir stage --shrink tree.img >&2
  rm -rf stage
  sync
  ls -l tree.img >&2
fi

loopdev() { losetup -j "$W/tree.img" | cut -d: -f1 | head -1; }

detach() {
  local L; L=$(loopdev)
  [ -z "$L" ] && return
  if findmnt -no TARGET "$L" >/dev/null 2>&1; then udisksctl unmount --no-user-interaction -b "$L" >/dev/null; fi
  udisksctl loop-delete --no-user-interaction -b "$L" >/dev/null
}

# Detach, evict the image's pages, reattach, and leave the mount point in $M and the loop device in $L.
drop() {
  detach
  sync
  echo "$W/tree.img" | python3 -I "$P/evict.py" /dev/stdin 2>/dev/null
  RES=$(fincore -nb -o RES "$W/tree.img" | tr -d ' ')
  udisksctl loop-setup --no-user-interaction -f "$W/tree.img" >/dev/null
  L=$(loopdev)
  for _ in $(seq 50); do M=$(findmnt -no TARGET "$L" 2>/dev/null || true); [ -n "$M" ] && break; sleep 0.1; done
  if [ -z "$M" ]; then udisksctl mount --no-user-interaction -o ro -b "$L" >/dev/null; M=$(findmnt -no TARGET "$L"); fi
}

sectors() { awk -v d="${L#/dev/}" '$3==d{print $4, $6}' /proc/diskstats; }

# ms <label> <command...>: prints "<label> <ms> ms, <lines> rows, <reads> reads, <MB> MB from the loop device".
ms() {
  local label=$1; shift
  local b a s e
  b=($(sectors)); s=$(date +%s%N); "$@" > "$W/last.out"; e=$(date +%s%N); a=($(sectors))
  printf '%-28s %6d ms %7d rows %7d reads %7.1f MB\n' "$label" $(( (e-s)/1000000 )) "$(wc -l < "$W/last.out")" \
    $(( a[0]-b[0] )) "$(awk -v x=$(( a[1]-b[1] )) 'BEGIN{printf "%.1f", x*512/1e6}')"
}

echo "== image $(ls -l --block-size=M tree.img | awk '{print $5}'), $(nproc) cores, $(uptime | sed 's/.*load/load/')"
for r in $(seq "$ROUNDS"); do
  drop; echo "-- round $r, image pages resident before the cold run: $RES bytes, mounted at $M"
  cd "$M"
  ms "listing cold (ignore file)" rg --files --ignore-file "$IG" .
  ms "listing warm" rg --files --ignore-file "$IG" .
  printf 'frecency\n' > "$W/q.txt"
  ms "content cold" rg -l -F -i -f "$W/q.txt" --max-filesize 1M --ignore-file "$IG" .
  ms "content warm" rg -l -F -i -f "$W/q.txt" --max-filesize 1M --ignore-file "$IG" .
  cd "$W"
done
for r in $(seq "$ROUNDS"); do
  drop; echo "-- round $r, full tree (the daily large-subtree pass), resident before: $RES bytes"
  cd "$M"
  ms "full listing cold" rg --files .
  ms "full listing warm" rg --files .
  cd "$W"
done
detach
