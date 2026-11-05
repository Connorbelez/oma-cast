#!/bin/bash
# Runs ContentSearch's script with the real rg over two roots that each hold
# 2,000 short and 1,000 20 KB matching lines, and counts the output lines
# that fail JSON.parse. Usage: pipe-mix.sh [runs] [ContentSearch.qml]
set -e
runs=${1:-10}
qml=$(readlink -f "${2:-$(dirname "$(readlink -f "$0")")/../../services/ContentSearch.qml}")
d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT
mkdir "$d/home" "$d/conf"
pad=$(head -c 20000 /dev/zero | tr '\0' x)
for r in home conf; do
  for i in $(seq 2000); do echo "short mixword $i" >"$d/$r/s$i.txt"; done
  for i in $(seq 1000); do echo "long mixword $pad" >"$d/$r/l$i.txt"; done
done
: >"$d/ignore"; : >"$d/untouched"
node - "$qml" "$d" "$runs" <<'JS'
const fs = require("node:fs"), { spawnSync } = require("node:child_process")
const [file, d, runs] = process.argv.slice(2)
const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("  readonly property string searchScript: '"))
const script = new Function("return " + line.slice(line.indexOf("'")))()
for (let i = 1; i <= Number(runs); i++) {
  const r = spawnSync("timeout", ["-k", "2", "5", "bash", "-c", script, "omacast-content", d + "/home", d + "/conf", d + "/ignore", d + "/untouched"],
    { input: "mixword\n", encoding: "utf8", cwd: d, maxBuffer: 1 << 28 })
  const lines = r.stdout.split("\n").filter(Boolean)
  const bad = lines.filter((l) => { try { JSON.parse(l); return false } catch { return true } }).length
  console.log(`run ${i}: exit ${r.status}, ${lines.length} lines, ${bad} parse failures`)
}
JS
