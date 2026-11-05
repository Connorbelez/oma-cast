const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const FileRanker = require("../core/FileRanker.js")

const HOME = "/home/u"
const row = (p) => ({ path: HOME + "/" + p, name: p.slice(p.lastIndexOf("/") + 1), dir: HOME + "/" + p.slice(0, p.lastIndexOf("/")) })

// Name counts shaped like the dev machine's in docs/phase7-prototypes/README.md:
// two names hold "frec", seven hold "fre", 63 hold "copyright", five hold
// "zoxide" and none hold "zox q".
const rows = [
  "Projects/oma-cast/core/Frecency.js", "Projects/oma-cast/tests/frecency.test.js",
  "Downloads/freedesktop.pdf", "Dev/fresh.md", "Music/freeze.flac", "Pictures/fremont.png", "Dev/free.c",
  ...Array.from({ length: 63 }, (_, i) => `Dev/vendor/lib${i}/COPYRIGHT`),
  ".config/zoxide/zoxide.toml", "Dev/zoxide/zoxide.fish", "Dev/zoxide/zoxide.lua", "Dev/zoxide/zoxide-init.sh", "Dev/zoxide/zoxide.1",
  "Projects/oma-cast/SPEC.md", "Projects/oma-cast/Launcher.qml"
].map(row)

// The first prefix of a typed query that reveals content rows, or null.
function revealsAt(query) {
  for (let i = 1; i <= query.length; i++) {
    const prefix = query.slice(0, i)
    if (FileRanker.revealContent(prefix, rows, false)) return prefix
  }
  return null
}

test("content rows reveal at frec, on the space in zoxide q, and never for copyright", () => {
  assert.deepEqual(
    ["frecency", "zoxide query", "copyright", "searchmatch"].map((q) => [q, revealsAt(q)]),
    [["frecency", "frec"], ["zoxide query", "zoxide q"], ["copyright", null], ["searchmatch", "sea"]]
  )
  assert.deepEqual(["fre", "frec", "zoxide", "zoxide q", "copyright"].map((q) => FileRanker.nameHits(rows, q)), [7, 2, 5, 0, 63])
})

const named = (name, n) => Array.from({ length: n }, (_, i) => row(`Dev/d${i}/${name}`))

test("the Contents dropdown forces content rows from three characters on", () => {
  assert.deepEqual(["co", "cop", "copyright", "  co  ", " frec "].map((q) => FileRanker.revealContent(q, rows, true)), [false, true, true, false, true])
  assert.equal(FileRanker.revealContent("fr", named("fr.md", 0), false), false)
  assert.equal(FileRanker.revealContent("fre", named("fresh.md", 4), false), true)
  assert.equal(FileRanker.revealContent("fre", named("fresh.md", 5), false), false)
})

test("a space in the query reveals contents however many names hold it", () => {
  const notes = named("my notes.md", 6)
  assert.deepEqual([FileRanker.nameHits(notes, "my notes"), FileRanker.revealContent("my notes", notes, false)], [6, true])
  assert.deepEqual([FileRanker.nameHits(notes, "notes"), FileRanker.revealContent("notes", notes, false)], [6, false])
})

test("the reveal rule counts names only when the length, the dropdown and the space leave it open", () => {
  assert.deepEqual([["fr", false], ["zoxide q", false], ["copyright", true]].map(([q, forced]) => FileRanker.revealContent(q, null, forced)), [false, true, true])
  assert.throws(() => FileRanker.revealContent("frec", null, false), TypeError)
})

const match = (file, text, line, sub) => JSON.stringify({ type: "match", data: {
  path: { text: file }, lines: { text }, line_number: line, absolute_offset: 0, submatches: [{ match: { text: sub }, start: 0, end: sub.length }]
} })

// Lines in the shape rg 15 prints with --json --max-count 1.
const RG_OUTPUT = [
  JSON.stringify({ type: "begin", data: { path: { text: HOME + "/Projects/oma-cast/core/Frecency.js" } } }),
  match(HOME + "/Projects/oma-cast/core/Frecency.js", "\tconst score = Frecency.score(anchor)\n", 12, "Frec"),
  JSON.stringify({ type: "end", data: { path: { text: HOME + "/Projects/oma-cast/core/Frecency.js" }, binary_offset: null, stats: { matches: 1 } } }),
  match(HOME + "/Dev/notes/long.md", "x".repeat(80) + " the frecency of a file decays\r\n", 3, "frec"),
  JSON.stringify({ type: "match", data: { path: { text: HOME + "/Dev/latin.txt" }, lines: { bytes: "Y2Fm6SBmcmVjZW5jeQo=" }, line_number: 1, submatches: [{ match: { text: "frec" }, start: 5, end: 9 }] } }),
  JSON.stringify({ type: "match", data: { path: { bytes: "L2hvbWUvdS9i/3IudHh0" }, lines: { text: "frec\n" }, line_number: 1, submatches: [] } }),
  match(HOME + "/Dev/notes/cut.md", "frecency", 1, "frec").slice(0, 60),
  JSON.stringify({ type: "summary", data: { stats: { matches: 3 } } }),
  ""
].join("\n")

test("rg --json match lines become { path, line, text } with the matching line trimmed", () => {
  assert.deepEqual(FileRanker.contentMatches(RG_OUTPUT), [
    { path: HOME + "/Projects/oma-cast/core/Frecency.js", line: 12, text: "const score = Frecency.score(anchor)" },
    { path: HOME + "/Dev/notes/long.md", line: 3, text: "…frecency of a file decays" },
    { path: HOME + "/Dev/latin.txt", line: 1, text: "" }
  ])
  assert.deepEqual(FileRanker.contentMatches(""), [])
})

test("a matching line longer than 200 characters is cut after 200, and a match in a long word starts it", () => {
  const [m] = FileRanker.contentMatches(match(HOME + "/a.txt", "frecency " + "y".repeat(400), 1, "frec"))
  assert.equal(m.text, "frecency " + "y".repeat(191))
  const [w] = FileRanker.contentMatches(match(HOME + "/b.txt", "import \"core/Frecency.js\" as Frecency", 1, "Frec"))
  assert.equal(w.text, "import \"core/Frecency.js\" as Frecency")
  const [x] = FileRanker.contentMatches(match(HOME + "/c.txt", "a".repeat(30) + "Frecency", 1, "Frec"))
  assert.equal(x.text, "…Frecency")
})

test("control characters inside the matching line become one space each run", () => {
  const [m] = FileRanker.contentMatches(match(HOME + "/d.log", "a\u0000\u0000b\u001b[31mfrec\u007fend\n", 1, "frec"))
  assert.equal(m.text, "a b [31mfrec end")
})

test("content rows keep listed files only, best folder prior first, then the shorter path, at most 20", () => {
  const music = Array.from({ length: 20 }, (_, i) => `Music/m${String(i).padStart(2, "0")}.txt`)
  const listed = [
    "Projects/oma-cast/core/Frecency.js", "Projects/oma-cast/SPEC.md", "Downloads/a/notes.md", "Downloads/notes.md", "Dev/x.md",
    "Music/a-much-longer-name.txt", ...music
  ].map(row)
  const probe = `  40.0 ${HOME}/Projects/oma-cast\n  2.0 ${HOME}/Dev\n  0.5 ${HOME}/Downloads\n`
  const s = FileRanker.signals(probe, {}, HOME, 1_700_000_000_000)
  const matches = [
    "Music/a-much-longer-name.txt", "Music/m19.txt", "Downloads/a/notes.md", "Dev/x.md", "Downloads/notes.md", "Projects/oma-cast/SPEC.md",
    "Projects/oma-cast/core/Frecency.js", ".ssh/config", "Unlisted/new.md", ...music.slice(0, 19)
  ].map((p) => ({ path: HOME + "/" + p, line: 1, text: "t" }))
  const got = FileRanker.contentRows(matches, s, listed).map((m) => m.path.slice(HOME.length + 1))
  assert.deepEqual(got, [
    "Projects/oma-cast/SPEC.md", "Projects/oma-cast/core/Frecency.js", "Dev/x.md", "Downloads/notes.md", "Downloads/a/notes.md",
    "Music/m00.txt", "Music/m01.txt", "Music/m02.txt", "Music/m03.txt", "Music/m04.txt", "Music/m05.txt", "Music/m06.txt",
    "Music/m07.txt", "Music/m08.txt", "Music/m09.txt", "Music/m10.txt", "Music/m11.txt", "Music/m12.txt", "Music/m13.txt", "Music/m14.txt"
  ])
  assert.deepEqual(FileRanker.contentRows(matches.slice(0, 1), s, listed), [{ path: HOME + "/Music/a-much-longer-name.txt", line: 1, text: "t" }])
})

test("subsequence-only name rows are loose, so contents replace them, unless an open lifts them", () => {
  const files = ["Projects/oma-cast/core/Frecency.js", "Dev/tf1-worker-mutation.cjs", "Dev/funding-recon.md"].map(row)
  const s = FileRanker.signals("", { [HOME + "/Dev/funding-recon.md"]: 101 }, HOME, 1_700_000_000_000)
  assert.deepEqual(FileRanker.rank(files, "frec", s).rows.map((r) => [r.name, r.band, r.loose]), [
    ["Frecency.js", 1, false], ["funding-recon.md", 4, false], ["tf1-worker-mutation.cjs", 4, true]
  ])
})

// ContentSearch.qml's functions run against stand-ins for its Process and
// Timers, the way tests/native-search.test.js runs NativeSearch.qml.
function harness() {
  const source = fs.readFileSync(path.join(__dirname, "../services/ContentSearch.qml"), "utf8")
  const log = [], signals = []
  const service = { pending: null, killAfterMs: 300, message: (level, text) => log.push(text) }
  const run = { request: null, homeRoot: "", configRoot: "", exited: false, streamed: false, stdinEnabled: false, running: false, code: -1, signal: (n) => signals.push(n) }
  const timer = () => ({ active: false, restart() { this.active = true }, stop() { this.active = false } })
  const output = { text: "" }
  const context = vm.createContext({ service, run, output, killTimer: timer(), watchdog: timer(), FileRanker, Date })
  for (const name of ["search", "start", "cancel", "kill", "finished"]) {
    const start = source.indexOf("  function " + name + "(")
    assert.ok(start >= 0, name)
    const end = source.indexOf("\n  }", start) + 4
    vm.runInContext(source.slice(start, end).trim(), context)
    service[name] = context[name]
  }
  const exit = (text) => {
    output.text = text
    run.running = false
    run.exited = true
    run.streamed = true
    service.finished()
  }
  return { service, run, context, log, signals, exit }
}

const ROOTS = [HOME, HOME + "/.config"]

test("a new request kills the running rg, and the killed run's late rows are never delivered", () => {
  const h = harness(), got = []
  h.service.search({ serial: 4, query: "frec", roots: ROOTS }, (r) => got.push(r))
  assert.deepEqual([h.run.request.serial, h.run.homeRoot, h.run.configRoot, h.run.running], [4, HOME, HOME + "/.config", true])
  h.service.search({ serial: 5, query: "frece", roots: ROOTS }, (r) => got.push(r))
  assert.deepEqual(h.signals, [15])
  assert.equal(h.run.request.serial, 4, "the killed run must exit before the next starts")
  h.exit(match(HOME + "/a.txt", "frec", 1, "frec"))
  assert.deepEqual(got, [])
  assert.equal(h.run.request.serial, 5)
  h.exit(match(HOME + "/b.txt", "frece here", 2, "frece"))
  assert.deepEqual(got.map((r) => [r.serial, r.matches, r.killed]), [[5, [{ path: HOME + "/b.txt", line: 2, text: "frece here" }], false]])
  assert.equal(h.service.pending, null)
  assert.deepEqual(h.log.map((l) => l.replace(/\d+ ms/, "N ms")), ["content: cancelled", "content: 1 files in N ms"])
})

test("the kill timer stops rg and delivers the rows read before it", () => {
  const h = harness(), got = []
  h.service.search({ serial: 9, query: "copyright", roots: ROOTS }, (r) => got.push(r))
  h.service.kill()
  assert.deepEqual(h.signals, [15])
  h.exit([match(HOME + "/LICENSE", "Copyright 2026", 1, "Copyright"), match(HOME + "/NOTICE", "Copyright", 1, "Copyright").slice(0, 30)].join("\n"))
  assert.deepEqual(got.map((r) => [r.serial, r.matches.map((m) => m.path), r.killed]), [[9, [HOME + "/LICENSE"], true]])
  assert.deepEqual(h.log.map((l) => l.replace(/\d+ files in \d+ ms/, "N")), ["content: killed at 300 ms", "content: N"])
})

test("a hide or keystroke with nothing running cancels nothing", () => {
  const h = harness()
  assert.equal(h.service.cancel(), false)
  h.service.kill()
  assert.deepEqual([h.log, h.signals], [[], []])
  h.service.search({ serial: 2, query: "frec", roots: ROOTS }, () => {})
  assert.equal(h.service.cancel(), true)
})

// The content script under timeout, as ContentSearch starts it, with one fake
// rg per root. Each prints its lines, marks that it has, and then either exits
// or stops itself, so only the SIGTERM to timeout that kill() sends ends the
// run.
function killedRun(t, roots) {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "omacast-content-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(dir + "/ignore", ".ssh/\n")
  fs.writeFileSync(dir + "/untouched", "")
  fs.mkdirSync(dir + "/marks")
  fs.writeFileSync(dir + "/rg", [
    "#!/bin/bash",
    "root=${@: -1}",
    "cat >/dev/null",
    'if [[ $root == */.config ]]; then n=$CONFIG_LINES stop=$CONFIG_STOPS; else n=$HOME_LINES stop=$HOME_STOPS; fi',
    "for ((i = 1; i <= n; i++)); do",
    `  printf '{"type":"match","data":{"path":{"text":"%s/f%02d.md"},"lines":{"text":"frec %s\\\\n"},"line_number":1,"submatches":[{"match":{"text":"frec"},"start":0,"end":4}]}}\\n' "$root" $i "$PAD"`,
    "done",
    ': >"$MARKS/${root##*/}"',
    "[[ $stop == 1 ]] && kill -STOP $$",
    "exit 0"
  ].join("\n") + "\n", { mode: 0o755 })
  const source = fs.readFileSync(path.join(__dirname, "../services/ContentSearch.qml"), "utf8")
  const line = source.split("\n").find((l) => l.startsWith("  readonly property string searchScript: '"))
  const script = new Function("return " + line.slice(line.indexOf("'")))()
  const env = {
    ...process.env, PATH: dir + ":" + process.env.PATH, MARKS: dir + "/marks", PAD: "x".repeat(roots.pad || 0),
    HOME_LINES: String(roots.home[0]), HOME_STOPS: roots.home[1] ? "1" : "0", CONFIG_LINES: String(roots.config[0]), CONFIG_STOPS: roots.config[1] ? "1" : "0"
  }
  const child = require("node:child_process").spawn("timeout", ["-k", "2", "5", "bash", "-c", script, "omacast-content", HOME, HOME + "/.config", dir + "/ignore", dir + "/untouched"], { env })
  child.stdin.end("frec\n")
  let out = ""
  child.stdout.on("data", (d) => { out += d })
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (fs.readdirSync(dir + "/marks").length < 2) return
      clearInterval(poll)
      setTimeout(() => child.kill("SIGTERM"), 100)
    }, 10)
    child.on("close", (_, signal) => resolve({ signal, paths: FileRanker.contentMatches(out).map((m) => m.path.slice(HOME.length + 1)) }))
  })
}

const files = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}f${String(i + 1).padStart(2, "0")}.md`)

test("a killed run delivers every line rg printed before the kill, from either root", async (t) => {
  const short = await killedRun(t, { home: [5, true], config: [0, false] })
  assert.deepEqual([short.signal, short.paths], ["SIGTERM", files("", 5)])
  const long = await killedRun(t, { home: [22, true], config: [0, false], pad: 3000 })
  assert.deepEqual([long.signal, long.paths], ["SIGTERM", files("", 22)])
  const held = await killedRun(t, { home: [0, true], config: [5, false] })
  assert.deepEqual([held.signal, held.paths], ["SIGTERM", files(".config/", 5)])
})
