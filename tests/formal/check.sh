#!/bin/bash
# Model-checks the launcher's async search ordering (tests/formal/SearchOrdering.tla)
# against the guard lines the code has right now.
#
#   tests/formal/check.sh                 safety, then liveness (about 1.5 min)
#   tests/formal/check.sh --safety        invariants only (about 10 s)
#   tests/formal/check.sh --liveness      SearchSettles only
#   tests/formal/check.sh --set Name=VAL  override one model constant (repeatable)
#   tests/formal/check.sh --mutants       prove each property can fail (about 30 s)
#
# Exit codes: 0 all checked properties hold, 1 a property is violated,
# 3 the model no longer matches the code's shape (re-sync it first),
# 4 the toolchain could not run.
#
# TLC output, including every counterexample, is kept under
# ~/.cache/omacast/tla/runs/<time>/ ; the last line of each run says where.
set -uo pipefail

TLA_VERSION=1.7.4
TLA_SHA256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
TLA_URL="https://github.com/tlaplus/tlaplus/releases/download/v$TLA_VERSION/tla2tools.jar"
JAVA_PIN=java@temurin-25

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
cache="${XDG_CACHE_HOME:-$HOME/.cache}/omacast/tla"
jar="$cache/tla2tools-$TLA_VERSION.jar"

die() { echo "check.sh: $*" >&2; exit 4; }

mode=all
sets=()
while (( $# )); do
  case $1 in
    --safety) mode=safety ;;
    --liveness) mode=liveness ;;
    --mutants) mode=mutants ;;
    --set) [[ ${2:-} == *=* ]] || die "--set needs Name=VALUE"; sets+=("$2"); shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument $1" ;;
  esac
  shift
done

# Private like the rest of omacast's cache (SPEC §2.0 "Privacy").
umask 077
mkdir -p "$cache" && chmod 700 "${cache%/tla}" "$cache" || die "cannot create $cache"

if [[ ! -f $jar ]] || ! echo "$TLA_SHA256  $jar" | sha256sum -c --quiet - 2>/dev/null; then
  echo "downloading tla2tools $TLA_VERSION"
  curl -fsSL -o "$jar.part" "$TLA_URL" || die "download failed: $TLA_URL"
  echo "$TLA_SHA256  $jar.part" | sha256sum -c --quiet - || { rm -f "$jar.part"; die "tla2tools.jar checksum mismatch"; }
  mv "$jar.part" "$jar"
fi

if [[ -n ${OMACAST_JAVA:-} ]]; then
  java=("$OMACAST_JAVA")
elif java -version >/dev/null 2>&1; then
  java=(java)
elif command -v mise >/dev/null; then
  java=(mise x "$JAVA_PIN" -- java)
  "${java[@]}" -version >/dev/null 2>&1 || die "no Java: install one, or set OMACAST_JAVA=/path/to/java"
else
  die "no Java (17 or newer): install one, or set OMACAST_JAVA=/path/to/java"
fi

anchors=$(node "$repo/tests/formal/anchors.js" --json)
status=$?
if (( status == 2 )); then
  echo "MODEL OUT OF SYNC: the code changed in a place the model assumes. Re-sync before trusting a result:"
  node -e 'for (const p of JSON.parse(process.argv[1]).problems) console.log("  " + p)' "$anchors"
  exit 3
fi
(( status == 0 )) || die "anchors.js failed"

runs="$cache/runs/$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$runs"

# base.cfg: the committed cfg with the guard constants the code has now.
node - "$anchors" "$here/SearchOrdering.cfg" "$runs/base.cfg" "${sets[@]}" <<'NODE' || exit 4
const fs = require("node:fs")
const [anchorsJson, from, to, ...sets] = process.argv.slice(2)
const { guards } = JSON.parse(anchorsJson)
let cfg = fs.readFileSync(from, "utf8")
const baseline = {}
for (const m of cfg.matchAll(/^  (\w+) = (\w+)$/gm)) baseline[m[1]] = m[2]
const set = (name, value) => {
  if (!(name in baseline)) { console.error(`check.sh: unknown constant ${name}`); process.exit(1) }
  cfg = cfg.replace(new RegExp(`^  ${name} = \\w+$`, "m"), `  ${name} = ${value}`)
}
const drift = []
for (const [name, present] of Object.entries(guards)) {
  const value = present ? "TRUE" : "FALSE"
  if (baseline[name] !== value) drift.push(`${name} = ${value} (baseline ${baseline[name]})`)
  set(name, value)
}
for (const s of sets) { const [n, v] = s.split("="); set(n, v) }
if (drift.length) console.log("code differs from the baseline cfg:\n  " + drift.join("\n  "))
if (sets.length) console.log("overrides: " + sets.join(", "))
fs.writeFileSync(to, cfg)
NODE

# variant <out.cfg> <property-or-invariant>... : keep only the named checks.
variant() {
  local out=$1; shift
  local keep=" $* "
  awk -v keep="$keep" '
    /^(INVARIANTS|PROPERTIES)$/ { section = $1; next }
    section && /^  [A-Za-z]+$/ { name = $1; if (index(keep, " " name " ")) { items[section] = items[section] "  " name "\n" }; next }
    { section = ""; print }
    END { for (s in items) printf "%s\n%s", s, items[s] }
  ' "$runs/base.cfg" >"$out"
}

# tlc <label> <cfg> : run TLC, print one PASS/FAIL line with the violated
# property and the trace's action names.
tlc() {
  local label=$1 cfg=$2 log="$runs/$1.log"
  local t0=$SECONDS
  (cd "$here" && "${java[@]}" -XX:+UseParallelGC -cp "$jar" tlc2.TLC -deadlock -workers auto \
    -metadir "$runs/$label.states" -config "$cfg" SearchOrdering.tla) >"$log" 2>&1
  local code=$? took=$(( SECONDS - t0 ))
  rm -rf "$runs/$label.states"
  if grep -q "Model checking completed. No error has been found." "$log"; then
    printf 'PASS  %-10s %s  (%s s, %s distinct states)\n' "$label" "$(checks "$cfg")" "$took" \
      "$(grep -oE '[0-9]+ distinct states found' "$log" | tail -1 | cut -d' ' -f1)"
    return 0
  fi
  local what
  what=$(grep -oE 'Invariant [A-Za-z]+ is violated|Temporal properties were violated' "$log" | head -1)
  if [[ -z $what ]]; then
    printf 'ERROR %-10s TLC exited %s without a verdict; see %s\n' "$label" "$code" "$log"
    return 4
  fi
  printf 'FAIL  %-10s %s  (%s s)\n' "$label" "$what" "$took"
  printf '      trace: %s\n' "$(grep -oE '^State [0-9]+: <[A-Za-z]+|^State [0-9]+: Stuttering|Back to state [0-9]+' "$log" |
    sed -E 's/^State [0-9]+: <?//' | paste -sd' ' | sed 's/ / -> /g')"
  printf '      log:   %s\n' "$log"
  return 1
}

checks() { awk '/^  [A-Za-z]+$/ && prev ~ /^(INVARIANTS|PROPERTIES)$|^  / { printf "%s%s", sep, $1; sep="," } { prev=$0 }' "$1"; }

result=0
run() { tlc "$@"; local r=$?; (( r > result )) && result=$r; return 0; }

case $mode in
  safety|all)
    variant "$runs/safety.cfg" NoStaleActivation NoStaleOverwrite RepliesMatchCatalog SettledRowsAreCurrent
    run safety "$runs/safety.cfg"
    ;;&
  liveness|all)
    variant "$runs/liveness.cfg" SearchSettles
    run liveness "$runs/liveness.cfg"
    ;;
  mutants)
    # Each row: constants flipped the way deleted lines flip them, and the
    # one property that must then fail. A PASS here means the property can
    # no longer fail, which is itself a bug in the verification.
    while read -r name setting property; do
      [[ -z $name || $name == \#* ]] && continue
      cp "$runs/base.cfg" "$runs/m.cfg"
      IFS=, read -ra pairs <<<"$setting"
      for pair in "${pairs[@]}"; do
        sed -i -E "s/^  ${pair%%=*} = \\w+$/  ${pair%%=*} = ${pair#*=}/" "$runs/m.cfg"
      done
      cp "$runs/base.cfg" "$runs/base.keep"; cp "$runs/m.cfg" "$runs/base.cfg"
      variant "$runs/$name.cfg" "$property"
      cp "$runs/base.keep" "$runs/base.cfg"
      if tlc "$name" "$runs/$name.cfg" >"$runs/$name.out"; then
        echo "BAD   $name: $setting did not break $property"; result=1
      else
        echo "ok    $name: $setting breaks $property"
        sed -n '2p' "$runs/$name.out"
      fi
    done <<'MUTANTS'
no-perform-guard     GuardPerform=FALSE        NoStaleActivation
no-actions-guard     GuardActions=FALSE        NoStaleActivation
no-reply-id-check    ReplyIdCheck=FALSE        NoStaleOverwrite
no-reply-id-check2   ReplyIdCheck=FALSE        SettledRowsAreCurrent
send-before-load     SendOnlyWhenLoaded=FALSE  RepliesMatchCatalog
# Reindex is guarded three times over; only all three gone lets a reply
# computed on the old catalog through.
reindex-unguarded    CancelOnReindex=FALSE,InvalidateCancels=FALSE,GuardRevision=FALSE  RepliesMatchCatalog
MUTANTS
    ;;
esac

echo "runs kept in $runs"
exit $result
