const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const FileRanker = require("../core/FileRanker.js")
const Frecency = require("../core/Frecency.js")
const fixture = require("./fixtures/files-query-set.json")

const HOME = fixture.home
const rows = fixture.paths.map((p) => ({ path: p, name: p.slice(p.lastIndexOf("/") + 1), dir: p.slice(0, p.lastIndexOf("/")) }))
const signals = () => FileRanker.signals(fixture.probe, fixture.opens, HOME, fixture.nowMs)
const ranked = (query) => FileRanker.rank(rows, query, signals()).rows
const short = (row) => row.path.slice(HOME.length + 1)
const rankOf = (query, target) => ranked(query).findIndex((r) => r.path === target) + 1
const row = (p) => ({ path: HOME + "/" + p, name: p.slice(p.lastIndexOf("/") + 1), dir: HOME + "/" + p.slice(0, p.lastIndexOf("/")) })

// The prototype's bounded-lift column (docs/phase7-prototypes/README.md),
// except claude and readme. The prototype took the raw zoxide score, which
// gave oma-cast's 2.0 a weight of 2; ln(1 + 2) is 1.1, so the folders holding
// the fixture's two-open package.json and fifty-open SpectrumCycling.ui now
// lift their CLAUDE.md and README.md above oma-cast's.
const EXPECTED_RANKS = {
  "spec": 1, "oma spec": 1, "claude": 2, "readme": 3, "launcher": 1, "rootsearch": 1, "package json": 1,
  "package": 1, "skill": 1, "sales readme": 5, "app tsx": 1, "launch": 1, "cms users": 1
}

test("the 13-query set puts each target at its expected rank", () => {
  const got = Object.fromEntries(fixture.queries.map((q) => [q.query, rankOf(q.query, q.target)]))
  assert.deepEqual(got, EXPECTED_RANKS)
})

test("a fifty-times-opened prefix match never beats the exact SPEC.md", () => {
  const list = ranked("spec")
  const spectrum = list.find((r) => r.name === "SpectrumCycling.ui")
  const spec = list.find((r) => r.path === HOME + "/Projects/oma-cast/SPEC.md")
  assert.ok(spectrum.score > spec.score * 2, "the prefix match carries far more usage")
  assert.deepEqual(list.slice(0, 3).map(short), [
    "Projects/oma-cast/SPEC.md", "Work/tries/SPEC.md", "Applications/openrgb-ms1603-src/qt/SpectrumCycling.ui"
  ])
})

test("twenty-times-opened substring and subsequence matches never beat a prefix match", () => {
  assert.deepEqual(ranked("launch").map((r) => [r.name, r.band]), [
    ["Launcher.qml", 1], ["LauncherWindow.qml", 1], ["launcher.desktop", 1], ["launch-dev.sh", 1],
    ["EpicGamesLauncher-2.1.0-x86_64.AppImage", 3], ["app-launcher.svg", 2], ["quick_launch.sh", 2], ["lava-unicode-chart.html", 4]
  ])
})

test("the lift moves an opened substring match above unopened word-start matches, and a word-start match stays below prefix", () => {
  const names = ranked("launch").map((r) => r.name)
  assert.ok(names.indexOf("EpicGamesLauncher-2.1.0-x86_64.AppImage") < names.indexOf("app-launcher.svg"))
  const unopened = FileRanker.signals(fixture.probe, {}, HOME, fixture.nowMs)
  const plain = FileRanker.rank(rows, "launch", unopened).rows.map((r) => r.name)
  assert.deepEqual(plain.slice(4), ["quick_launch.sh", "app-launcher.svg", "EpicGamesLauncher-2.1.0-x86_64.AppImage", "lava-unicode-chart.html"])
})

test("one open lifts a substring match above word-start matches for its 10-day half-life", () => {
  const files = ["Downloads/ckage-a.txt", "Downloads/x-ckage.txt", "Dev/sales-crm/package.json", "Downloads/zzckagezz.txt"].map(row)
  const openedSec = fixture.nowMs / 1000
  const anchor = Frecency.recordVisit(null, fixture.nowMs).anchor
  const after = (days) => {
    const nowSec = openedSec + days * 86400
    const opens = { [HOME + "/Dev/sales-crm/package.json"]: Frecency.score(anchor, nowSec) }
    return FileRanker.rank(files, "ckage", FileRanker.signals("", opens, HOME, nowSec * 1000)).rows.map((r) => r.name)
  }
  assert.deepEqual([0, 9, 11].map((days) => Frecency.score(anchor, openedSec + days * 86400).toFixed(1)), ["101.0", "54.1", "47.1"])
  assert.deepEqual(after(0), ["ckage-a.txt", "package.json", "x-ckage.txt", "zzckagezz.txt"])
  assert.deepEqual(after(9), ["ckage-a.txt", "package.json", "x-ckage.txt", "zzckagezz.txt"])
  assert.deepEqual(after(11), ["ckage-a.txt", "x-ckage.txt", "package.json", "zzckagezz.txt"])
})

test("oma spec finds SPEC.md by the path band", () => {
  assert.deepEqual(ranked("oma spec").map((r) => [short(r), r.band]), [
    ["Projects/oma-cast/SPEC.md", 6], [".config/omarchy/themes/spectrum.toml", 6]
  ])
})

test("sales readme keeps the name matches first and never matches a segment by subsequence", () => {
  const list = ranked("sales readme")
  assert.deepEqual(list.map((r) => r.band), [2, 2, 2, 2, 6, 6])
  assert.equal(list.some((r) => r.path === HOME + "/wagertech/cmsv2/wagertech-cms-v2-migration/README.md"), false)
})

test("rank places every row in the band that band() gives it", () => {
  const queries = fixture.queries.map((q) => q.query).concat(["s", "e", "sales", "oma s", "cms spec", "app", "x y"])
  for (const query of queries) {
    for (const r of ranked(query)) assert.equal(r.band, FileRanker.band(query, r, HOME), `${query}: ${short(r)}`)
    const all = rows.filter((r) => FileRanker.band(query, r, HOME) >= 0).length
    assert.equal(FileRanker.rank(rows, query, signals()).hits, all, query)
  }
})

test("band names each kind of match", () => {
  const cases = [
    ["spec", "Projects/oma-cast/SPEC.md", 0], ["spec.md", "Projects/oma-cast/SPEC.md", 0], ["spec", "Downloads/specs.md", 1],
    ["spec", "test/users.spec.ts", 2], ["spec", "Downloads/inspection.txt", 3], ["spec", "Downloads/super-pack.zip", 4],
    ["oma spec", "Projects/oma-cast/SPEC.md", 6], ["cast spec", "Projects/oma-cast/SPEC.md", 6], ["spec", "Downloads/notes.md", -1],
    ["c++", "Documents/c++notes.md", 1], ["a.b", "Downloads/aXb.txt", -1]
  ]
  assert.deepEqual(cases.map(([q, p]) => FileRanker.band(q, row(p), HOME)), cases.map((c) => c[2]))
})

test("a file in the home dir matches no path segment of the home path itself", () => {
  const inHome = { path: HOME + "/notes.txt", name: "notes.txt", dir: HOME }
  const inU = { path: HOME + "/u/notes.txt", name: "notes.txt", dir: HOME + "/u" }
  assert.deepEqual(["home notes", "u notes"].map((q) => [FileRanker.band(q, inHome, HOME), FileRanker.band(q, inU, HOME)]), [[-1, -1], [-1, 6]])
  assert.deepEqual(FileRanker.rank([inHome, inU], "u notes", FileRanker.signals("", {}, HOME, fixture.nowMs)).rows.map((r) => r.path), [HOME + "/u/notes.txt"])
})

test("the empty query lists files by usage alone", () => {
  const recent = FileRanker.rank(rows, "  ", signals(), 4)
  assert.deepEqual(recent.rows.map(short), [
    "Applications/EpicGamesLauncher-2.1.0-x86_64.AppImage",
    "Applications/openrgb-ms1603-src/qt/SpectrumCycling.ui",
    "Downloads/lava-unicode-chart.html",
    "Dev/sales-crm/package.json"
  ])
  assert.equal(recent.hits, 164)
  const s = signals()
  FileRanker.prepare(rows, s, 4)
  assert.deepEqual(FileRanker.rank(rows, "", s, 4), recent, "prepare keeps the same rows for the empty query")
})

test("a file whose opens have all decayed counts as unopened", () => {
  const path = HOME + "/Pictures/avatar.png"
  const recentWith = (score) => FileRanker.rank(rows, "", FileRanker.signals(fixture.probe, { [path]: score }, HOME, fixture.nowMs)).rows.map((r) => r.path)
  assert.equal(recentWith(101).includes(path), true)
  assert.equal(recentWith(1).includes(path), false)
})

test("a limit keeps the best rows of the full order and the full hit count", () => {
  const counts = {}
  for (const query of ["", "readme", "s", "launch", "e", "sales readme"]) {
    const all = FileRanker.rank(rows, query, signals())
    counts[query] = all.hits
    for (const limit of [1, 3, 7, 20, 60]) {
      const some = FileRanker.rank(rows, query, signals(), limit)
      assert.deepEqual(some.rows.map(short), all.rows.slice(0, limit).map(short), `${JSON.stringify(query)} limit ${limit}`)
      assert.equal(some.hits, all.hits)
    }
  }
  assert.deepEqual(counts, { "": 164, readme: 13, s: 87, launch: 8, e: 182, "sales readme": 6 })
})

test("a busy zoxide folder never outranks files opened from omacast", () => {
  const files = ["Work/a.txt", "Work/b.txt", "Work/c.txt", "Work/d.txt", "Work/README.md", "Downloads/invoice.pdf", "Downloads/README.md"].map(row)
  const busy = "  40.0 /home/u/Work\n"
  const invoice = FileRanker.signals(busy, { [HOME + "/Downloads/invoice.pdf"]: 201 }, HOME, fixture.nowMs)
  assert.deepEqual(FileRanker.rank(files, "", invoice, 4).rows.map(short), ["Downloads/invoice.pdf", "Work/a.txt", "Work/b.txt", "Work/c.txt"])
  const readme = FileRanker.signals(busy, { [HOME + "/Downloads/README.md"]: 5000 }, HOME, fixture.nowMs)
  assert.deepEqual(FileRanker.rank(files, "readme", readme).rows.map(short), ["Downloads/README.md", "Work/README.md"])
})

test("the prior comes from the nearest weighted folder and decays with distance", () => {
  const s = signals()
  assert.equal(FileRanker.usage(row("Projects/oma-cast/SPEC.md"), s).prior.toFixed(4), "3.0986")
  assert.equal(FileRanker.usage(row("Projects/oma-cast/core/RootSearch.js"), s).prior.toFixed(4), "2.0657")
  assert.equal(FileRanker.usage(row("Projects/oma-cast/docs/phase7-prototypes/rank.js"), s).prior.toFixed(4), "1.5493")
  assert.equal(FileRanker.usage(row("Pictures/avatar.png"), s).prior, 0)
})

test("recency halves every 30 days for a row that carries an mtime, and is 0 without one", () => {
  const s = signals()
  const mtime = fixture.nowMs / 1000 - 30 * 86400
  assert.equal(FileRanker.usage(Object.assign(row("Pictures/avatar.png"), { mtime }), s).recency, 0.5)
  assert.equal(FileRanker.usage(row("Pictures/avatar.png"), s).recency, 0)
})

test("FileRanker matches names without a loop over their characters", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "core", "FileRanker.js"), "utf8")
  assert.equal(/charAt|charCodeAt|codePointAt|name\.split\(|for\s*\([^;]*\bof\s+[\w.]*name|while\s*\([^)]*name/.test(source), false)
  const indexed = source.match(/for\s*\(\s*var\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*[\w.]+/g) || []
  assert.deepEqual(indexed.filter((header) => /<\s*(?:[\w.]*\.)?(name|word|text|query|path|dir|line)\.length$/.test(header)), [])
  assert.equal(indexed.length > 0, true, "the lint saw the ranker's loops over rows and words")
})
