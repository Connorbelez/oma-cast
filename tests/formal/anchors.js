#!/usr/bin/env node
// Reads the QML the SearchOrdering model describes and reports, for each
// protective line, whether it is still there. tests/formal/check.sh turns
// the answer into the model's Guard*/Cancel* constants, so deleting a guard
// in the code is checked as deleting it in the model.
//
// Two kinds of anchor:
//   guard  - present => the constant is TRUE, absent => FALSE (the model
//            then explores the code without that line)
//   shape  - code the model assumes as written. If one is missing the model
//            may no longer describe the code: check.sh stops and asks for a
//            re-sync instead of reporting a pass.
//
// Usage: node tests/formal/anchors.js [--json]

"use strict"
const fs = require("node:fs")
const path = require("node:path")

const root = path.join(__dirname, "..", "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8")

// The text of one function or handler: from its opening line to the closing
// brace at the opening line's indent, or that line alone when it opens no
// block.
function body(file, opener) {
  const source = read(file)
  const start = source.indexOf(opener)
  if (start < 0) return null
  const lineStart = source.lastIndexOf("\n", start) + 1
  const indent = source.slice(lineStart).match(/^[ \t]*/)[0]
  const lineEnd = source.indexOf("\n", start)
  const firstLine = source.slice(start, lineEnd < 0 ? undefined : lineEnd)
  const opens = (firstLine.match(/{/g) || []).length
  const closes = (firstLine.match(/}/g) || []).length
  if (opens === closes) return firstLine
  const end = source.indexOf("\n" + indent + "}", start)
  return end < 0 ? null : source.slice(start, end + indent.length + 2)
}

const LW = "ui/LauncherWindow.qml"
const NS = "services/NativeSearch.qml"
const BE = "Backend.qml"
const RS = "search/src/protocol.rs"
const CS = "services/ContentSearch.qml"

// [constant, file, opener, [patterns that must all match]]
const GUARDS = [
  ["GuardPerform", LW, "  function perform(", [/if \(window\.searchPending\) return/]],
  ["GuardActions", LW, "  function actionsForSelected(", [/if \(window\.searchPending \|\|[^)]*\) return \[\]/]],
  ["GuardSerial", LW, "  function rebuild(", [/var serial = \+\+window\.searchSerial/, /serial !== window\.searchSerial/]],
  ["GuardRevision", LW, "  function rebuild(", [/var revision = window\.backend\.candidatesRevision/, /revision !== window\.backend\.candidatesRevision/]],
  ["CancelOnRebuild", LW, "  function rebuild(", [/window\.backend\.cancelSearch\(\)/]],
  ["CancelOnHide", LW, "  onShownChanged: {", [/window\.searchSerial\+\+/, /window\.backend\.cancelSearch\(\)/, /window\.searchPending = false/]],
  ["CancelOnReindex", BE, "  function rebuildCandidates(", [/nativeSearch\.cancel\(\)/]],
  ["InvalidateCancels", NS, "  function invalidate(", [/service\.cancel\(\)/, /if \(request\) request\.callback\(null\)/]],
  ["SendOnlyWhenLoaded", NS, "  function search(", [/else if \(service\.loaded\) service\.send\(\)/]],
  ["CalcSkipsAlert", LW, "    function onCalculatorRevisionChanged(", [/!window\.alert/]],
  ["ContentSerialCheck", LW, "  function searchContents(", [/var serial = window\.searchSerial/, /serial: serial/, /if \(reply\.serial !== window\.searchSerial\) \{/]],
  ["ContentPendingCheck", CS, "  function finished(", [/if \(request && request === service\.pending\) \{/]],
  ["CancelContentOnRebuild", LW, "  function rebuild(", [/window\.cancelContents\(\)/]],
  ["CancelContentOnHide", LW, "  onShownChanged: {", [/window\.cancelContents\(\)/]],
]

// receive() drops a reply whose id is not pending if either filter is there.
const REPLY_FILTERS = [
  /if \(data\.id !== service\.loadId && \(!request \|\| data\.id !== request\.id\)\) return/,
  /if \(!request \|\| data\.id !== request\.id\) return/,
]

// [what the model assumes, file, opener, [patterns]]
const SHAPES = [
  ["Backend.searchAsync answers empty queries and pushed views synchronously", BE, "  function searchAsync(",
    [/nativeSearch\.cancel\(\)/, /if \(!query \|\| \(view && view\.kind !== "root"\)\)/, /nativeSearch\.search\(/]],
  ["rebuild sets searchPending before searching and clears it in the guarded callback", LW, "  function rebuild(",
    [/window\.searchPending = true[\s\S]*window\.backend\.searchAsync\(/, /window\.applySearch\(result, keepId, restoreIndex\)\s*\n\s*window\.searchPending = false/]],
  ["candidate reloads rebuild only when shown with no panel or alert", LW, "    function onCandidatesRevisionChanged(",
    [/if \(window\.shown && !window\.actionPanelOpen && !window\.alert\) window\.rebuild\(false\)/]],
  ["calculator updates rebuild when shown, no panel and a query", LW, "    function onCalculatorRevisionChanged(",
    [/window\.shown && !window\.actionPanelOpen/, /window\.rebuild\(false\)/]],
  ["Backend swaps ids and entries, then bumps candidatesRevision", BE, "  function rebuildCandidates(",
    [/nativeSearch\.ids = [\s\S]*nativeSearch\.entries = entries[\s\S]*backend\.candidatesRevision\+\+/]],
  ["search() cancels first, falls back when disabled, starts the helper when idle", NS, "  function search(",
    [/service\.cancel\(\)/, /if \(service\.disabled/, /if \(!helper\.running\) helper\.running = true/]],
  ["invalidate() unloads and reloads a running helper", NS, "  function invalidate(",
    [/service\.loaded = false/, /if \(helper\.running\) service\.load\(\)/]],
  ["fail() disables the helper for good and answers with the JS matcher", NS, "  function fail(",
    [/service\.disabled = true/, /helper\.running = false/, /if \(request\) request\.callback\(null\)/]],
  ["receive() marks the load done, sends, and cancels before calling back", NS, "  function receive(",
    [/service\.loaded = true\s*\n\s*service\.send\(\)/, /service\.cancel\(\)\s*\n\s*request\.callback\(matches\)/, /catch \(error\) \{ service\.fail\(/]],
  ["cancel() also stops the timeout, so the timer runs exactly while a request is pending", NS, "  function cancel(",
    [/service\.pending = null/, /timeout\.stop\(\)/]],
  ["the timeout fails over to the JS matcher", NS, "    onTriggered:", [/service\.fail\(/]],
  ["the helper loads on start and fails over when it exits", NS, "    onStarted:", [/service\.load\(\)/]],
  ["the helper exit handler fails over unless already disabled", NS, "    onExited:", [/if \(!service\.disabled\) service\.fail\(/]],
  ["the root Files section is ranked inside rootSearch.search, so the reply that carries the flea hits carries it", BE, "      search: function(data) {",
    [/ctx\.fileHits = backend\.rootFileHits\(query, ctx\)\s*\n\s*sections = RootSearch\.rootSections\(/]],
  ["rootFileHits ranks synchronously and takes no callback", BE, "  function rootFileHits(",
    [/^  function rootFileHits\(query, ctx\) \{/, /return backend\.searchFiles\(/, /RootSearch\.pathHits\(/,
      /^  function rootFileHits\(query, ctx\) \{(?:(?!Qt\.callLater|\bProcess\b|function\s*\()[\s\S])*?\n  \}/]],
  ["cancelContents stops the stillness timer, then cancels ContentSearch", LW, "  function cancelContents(",
    [/contentDelay\.stop\(\)\s*\n\s*window\.backend\.cancelContents\(\)/]],
  ["Backend.cancelContents is ContentSearch.cancel", BE, "  function cancelContents(", [/^  function cancelContents\(\) \{ contentSearch\.cancel\(\) \}$/]],
  ["rebuild restarts the stillness timer only in the files view, after any cancel and before the synchronous search", LW, "  function rebuild(",
    [/if \(window\.filesView\) contentDelay\.restart\(\)\s*\n\s*window\.backend\.searchAsync\(/, /contentDelay\.restart\(\)(?![\s\S]*window\.cancelContents\(\))/]],
  ["popToRoot leaves the files view before its rebuild, so no hidden rebuild restarts the stillness timer", LW, "  function popToRoot(",
    [/window\.stack = \[\{ kind: "root"[\s\S]*window\.rebuild\(true\)/]],
  ["the files view answers synchronously in rootSearch.search", BE, "      search: function(data) {",
    [/view\.kind === "files"\) sections = view\.filter === "contents" \? \[\] : backend\.fileSections\(query\)/]],
  ["applySearch replaces every row, so the Contents section goes with the old name rows", LW, "  function applySearch(", [/Rows\.update\(rows, next\)/]],
  ["Backend.searchContents hands the request's serial back with the reply", BE, "  function searchContents(",
    [/contentSearch\.search\(\{ serial: data\.serial,/, /callback\(\{ serial: reply\.serial,/]],
  ["search() cancels, records the request, then starts", CS, "  function search(",
    [/service\.cancel\(\)\s*\n\s*service\.pending = \{[^\n]*\}\s*\n\s*service\.start\(\)/]],
  ["start() runs one request at a time and waits for a killed run to exit", CS, "  function start(",
    [/if \(!request \|\| run\.request \|\| run\.running\) return/, /run\.request = request/, /killTimer\.restart\(\)/]],
  ["cancel() drops the pending request and signals only its own run", CS, "  function cancel(",
    [/service\.pending = null/, /killTimer\.stop\(\)/, /if \(run\.request === request && run\.running\) run\.signal\(15\)/]],
  ["kill() signals the pending request's run and keeps the request pending", CS, "  function kill(",
    [/if \(!request \|\| run\.request !== request \|\| !run\.running\) return/, /run\.signal\(15\)/, /^(?![\s\S]*service\.pending =)/]],
  ["finished() waits for exit and output, clears the run, delivers, then starts a waiting request", CS, "  function finished(",
    [/if \(!run\.exited \|\| !run\.streamed\) return/, /run\.request = null[\s\S]*service\.pending = null[\s\S]*request\.callback\(\{ serial: request\.serial,[\s\S]*\}\s*\n\s*service\.start\(\)\s*\n  \}$/]],
  ["the helper answers one line at a time, in order", RS, "pub(crate) fn run(",
    [/read_until\(b'\\n'/, /response\(&line, &mut catalog\)/, /writer\.flush\(\)\?/]],
]

function check() {
  const guards = {}
  const problems = []
  for (const [name, file, opener, patterns] of GUARDS) {
    const text = body(file, opener)
    if (text === null) { problems.push(`${name}: cannot find "${opener.trim()}" in ${file}`); continue }
    guards[name] = patterns.every((p) => p.test(text))
  }
  const receive = body(NS, "  function receive(")
  if (receive === null) problems.push(`ReplyIdCheck: cannot find "function receive(" in ${NS}`)
  else guards.ReplyIdCheck = REPLY_FILTERS.some((p) => p.test(receive))

  for (const [what, file, opener, patterns] of SHAPES) {
    const text = body(file, opener)
    if (text === null) { problems.push(`shape "${what}": cannot find "${opener.trim()}" in ${file}`); continue }
    for (const p of patterns) if (!p.test(text)) problems.push(`shape "${what}": ${file} no longer matches ${p}`)
  }
  const callers = (read(LW).match(/window\.request\(/g) || []).length
  if (callers !== 3) problems.push(`shape "perform, confirmAlert and pick are the only callers of request()": found ${callers} calls to window.request( in ${LW}, expected 3`)
  const lw = read(LW)
  if (!/Timer \{\s*id: contentDelay\s*interval: 150\s*onTriggered: window\.searchContents\(\)\s*\}/.test(lw))
    problems.push(`shape "contentDelay is the only caller of searchContents()": the contentDelay Timer in ${LW} changed`)
  const contentCalls = (lw.match(/window\.searchContents\(/g) || []).length
  if (contentCalls !== 1) problems.push(`shape "contentDelay is the only caller of searchContents()": found ${contentCalls} calls to window.searchContents( in ${LW}, expected 1`)
  const cs = read(CS)
  if (!/id: killTimer\s*interval: service\.killAfterMs\s*onTriggered: service\.kill\(\)/.test(cs))
    problems.push(`shape "the kill timer calls kill()": the killTimer in ${CS} changed`)
  if (!/onExited: function\(exitCode, exitStatus\) \{[^}]*run\.exited = true\s*\n\s*service\.finished\(\)/.test(cs))
    problems.push(`shape "the run's exit reaches finished()": the onExited handler in ${CS} changed`)
  const writes = (read(LW).match(/window\.query = /g) || []).length
  if (writes !== 6) problems.push(`shape "every query write is followed by rebuild()": found ${writes} "window.query = " in ${LW}, expected 6; check the new one rebuilds, then update this count`)
  return { guards, problems }
}

if (require.main === module) {
  const result = check()
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(result) + "\n")
  } else {
    for (const [k, v] of Object.entries(result.guards)) console.log(`${v ? "present" : "ABSENT "}  ${k}`)
    for (const p of result.problems) console.log(`SHAPE    ${p}`)
  }
  process.exit(result.problems.length ? 2 : 0)
}

module.exports = { check, body }
