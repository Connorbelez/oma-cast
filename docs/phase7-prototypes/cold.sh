#!/bin/bash
# Disk-cold timing. Needs root once to drop the page, dentry and inode caches; everything else runs as the user.
# Usage: sudo sysctl -w vm.drop_caches=3 && ./cold.sh
cd ~
IG=$(dirname "$(readlink -f "$0")")/ignore.txt
ms() { local s=$(date +%s%N); "$@" >/dev/null; echo $(( ($(date +%s%N)-s)/1000000 )); }
echo "listing cold ms: $(ms rg --files --ignore-file "$IG" .)"
echo "listing warm ms: $(ms rg --files --ignore-file "$IG" .)"
echo "content cold ms: $(printf 'frecency\n' | ms rg -l -F -i -f - --max-filesize 1M --ignore-file "$IG" .)"
echo "content warm ms: $(printf 'frecency\n' | ms rg -l -F -i -f - --max-filesize 1M --ignore-file "$IG" .)"
echo "full-home listing cold ms (the daily large-subtree pass): run after another drop_caches: $(ms rg --files .)"
