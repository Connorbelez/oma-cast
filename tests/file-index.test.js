const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const FileIndex = require("../core/FileIndex.js")

const HOME = "/home/u"

// 40 paths: a 6-file vendor tree nobody touches, a 6-file project zoxide
// knows, 10 files in the home dir and 18 in six small folders.
function fixture() {
  const vendor = [1, 2, 3, 4, 5, 6].map((i) => `${HOME}/Applications/Engine/lib/part${i}.so`)
  const project = [1, 2, 3, 4, 5, 6].map((i) => `${HOME}/Dev/app/file${i}.ts`)
  const loose = Array.from({ length: 10 }, (_, i) => `${HOME}/note${i}.md`)
    .concat(Array.from({ length: 18 }, (_, i) => `${HOME}/notes${i % 6}/n${i}.md`))
  return [...vendor, ...project, ...loose]
}

// Runs FileIndex.RECOUNT_SCRIPT the way FileLister does, with an rg that
// prints `paths` for `rg --files <HOME>` and exits with `rgExit`.
function recount(t, paths, threshold, rgExit = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-recount-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(dir + "/list", paths.map((p) => p + "\n").join(""))
  fs.writeFileSync(dir + "/rg", `#!/bin/bash\n[[ $# == 2 && $1 == --files && $2 == ${HOME} ]] || exit 9\ncat ${dir}/list\nexit ${rgExit}\n`, { mode: 0o755 })
  return spawnSync("bash", ["-c", FileIndex.RECOUNT_SCRIPT, "omacast-recount", HOME, FileIndex.COUNT_PROGRAM, String(threshold)], {
    encoding: "utf8", env: { ...process.env, PATH: dir + ":" + process.env.PATH }
  })
}

function counts(t, paths, threshold) {
  const r = recount(t, paths, threshold)
  assert.equal(r.status, 0, r.stderr)
  return FileIndex.parseCounts(r.stdout)
}

test("the recount prints the root's file count and each directory over the threshold", (t) => {
  const r = recount(t, fixture().concat(["/etc/a/b", "/etc/a/c"]), 5)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.stdout.split("\n").filter(Boolean).sort(), [
    `42\t${HOME}`,
    `6\t${HOME}/Applications`,
    `6\t${HOME}/Applications/Engine`,
    `6\t${HOME}/Applications/Engine/lib`,
    `6\t${HOME}/Dev`,
    `6\t${HOME}/Dev/app`
  ])
})

test("the recount fails when rg fails", (t) => {
  assert.equal(recount(t, fixture(), 5, 2).status, 2)
})

test("parseCounts reads the recount's lines into a count per directory", () => {
  assert.deepEqual(FileIndex.parseCounts(`42\t${HOME}\n6\t${HOME}/a b\tc\nnoise\n`), { [HOME]: 42, [`${HOME}/a b\tc`]: 6 })
  assert.deepEqual(FileIndex.parseCounts(""), {})
})

test("largeSubtrees returns the untouched vendor tree and keeps the signalled one", (t) => {
  const paths = fixture()
  assert.equal(paths.length, 40)
  assert.deepEqual(FileIndex.largeSubtrees(counts(t, paths, 5), [`${HOME}/Dev/app`], 5, HOME), [
    { path: `${HOME}/Applications`, count: 6 }
  ])
})

test("largeSubtrees descends into a touched tree and flags the topmost untouched one", (t) => {
  assert.deepEqual(FileIndex.largeSubtrees(counts(t, fixture(), 5), [`${HOME}/Dev/app`, `${HOME}/Applications/notes`], 5, HOME), [
    { path: `${HOME}/Applications/Engine`, count: 6 }
  ])
})

test("largeSubtrees never flags the root, even with no signals at all", (t) => {
  const paths = fixture()
  assert.deepEqual(FileIndex.largeSubtrees(counts(t, paths.concat(paths.map((p) => p + ".bak")), 5), [], 5, HOME), [
    { path: `${HOME}/Applications`, count: 12 },
    { path: `${HOME}/Dev`, count: 12 },
    { path: `${HOME}/notes0`, count: 6 },
    { path: `${HOME}/notes1`, count: 6 },
    { path: `${HOME}/notes2`, count: 6 },
    { path: `${HOME}/notes3`, count: 6 },
    { path: `${HOME}/notes4`, count: 6 },
    { path: `${HOME}/notes5`, count: 6 }
  ])
})

test("at 5,000 a tree of exactly 5,000 stays, 5,001 is flagged, and a sibling's signal covers only itself", (t) => {
  const files = (dir, n) => Array.from({ length: n }, (_, i) => `${HOME}/${dir}/f${i}`)
  const paths = [...files("kept", 5000), ...files("vendor/a", 5001), ...files("vendor/b", 3), ...files("proj", 5001)]
  const c = counts(t, paths, FileIndex.DEFAULT_THRESHOLD)
  assert.equal(c[HOME], 15005)
  assert.deepEqual(FileIndex.largeSubtrees(c, [`${HOME}/vendor/b`, `${HOME}/proj-old`], FileIndex.DEFAULT_THRESHOLD, HOME), [
    { path: `${HOME}/proj`, count: 5001 },
    { path: `${HOME}/vendor/a`, count: 5001 }
  ])
})

test("parseList splits rg output into path, name and dir", () => {
  assert.deepEqual(FileIndex.parseList(`${HOME}/a/b.txt\n${HOME}/c\n`), [
    { path: `${HOME}/a/b.txt`, name: "b.txt", dir: `${HOME}/a` },
    { path: `${HOME}/c`, name: "c", dir: HOME }
  ])
  assert.deepEqual(FileIndex.parseList(""), [])
})

test("listOutcome swaps in the list only when every run exited normally with 0", () => {
  const run = (root, exitCode, exitStatus, text) => ({ root, exitCode, exitStatus, text })
  const home = run(HOME, 0, 0, `${HOME}/a\n`)
  assert.deepEqual(FileIndex.listOutcome([home, run(`${HOME}/.config`, 0, 0, `${HOME}/.config/b\n`)]), {
    rows: [{ path: `${HOME}/a`, name: "a", dir: HOME }, { path: `${HOME}/.config/b`, name: "b", dir: `${HOME}/.config` }]
  })
  assert.deepEqual(FileIndex.listOutcome([home, run(`${HOME}/.config`, 0, 1, `${HOME}/.config/b\n`)]), {
    warnings: [`files: rg exited abnormally for ${HOME}/.config; keeping the previous list`]
  })
  assert.deepEqual(FileIndex.listOutcome([run(HOME, 2, 0, `${HOME}/a\n`), run("/nonexistent", 2, 0, "")]), {
    warnings: [`files: rg exited 2 for ${HOME}; keeping the previous list`, "files: rg exited 2 for /nonexistent; keeping the previous list"]
  })
  assert.deepEqual(FileIndex.listOutcome([run(HOME, 3, 0, ""), home]), { missing: true })
  assert.deepEqual(FileIndex.listOutcome([run(HOME, 3, 1, ""), home]), { warnings: [`files: rg exited abnormally for ${HOME}; keeping the previous list`] })
})

test("parseSignals reads zoxide scores and git reflog paths", () => {
  const text = `   2.0 ${HOME}/Projects/oma-cast\n  0.8 ${HOME}/Dev cool\n${HOME}/Work/repo/.git/logs/HEAD\nnoise\n`
  assert.deepEqual(FileIndex.parseSignals(text), [`${HOME}/Projects/oma-cast`, `${HOME}/Dev cool`, `${HOME}/Work/repo`])
})

test("the default ignore file lists the build dirs and every private path", () => {
  const lines = FileIndex.defaultIgnoreText().split("\n").filter((l) => l && !l.startsWith("#"))
  assert.deepEqual(lines, [
    "node_modules/", ".cache/", "target/", ".git/", "Cache/", "Code Cache/", "Service Worker/", "compile-cache/",
    ".ssh/", ".gnupg/", ".password-store/", ".local/share/keyrings/",
    ".mozilla/", ".zen/", ".config/chromium/", ".config/google-chrome/", ".config/BraveSoftware/", ".config/zen/",
    ".env", ".env.*"
  ])
  assert.ok(FileIndex.defaultIgnoreText().endsWith("\n"))
})

test("ignores matches plain names anywhere and slashed patterns from the root", () => {
  const text = FileIndex.defaultIgnoreText() + "/Applications/UnrealEngine/\nDownloads/*.iso\n"
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/node_modules`), true)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/Dev/app/node_modules/react`), true)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/Applications/UnrealEngine`), true)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/Applications/UnrealEngine/Engine`), true)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/Applications/UnrealEngineOld`), false)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/Other/Applications/UnrealEngine`), false)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/Downloads/disk.iso`), true)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/Dev`), false)
  assert.equal(FileIndex.ignores("# node_modules/\n!Dev/\n", HOME, `${HOME}/node_modules`), false)
})

test("ignoreLine anchors the tree to the root and escapes every glob character rg reads", () => {
  assert.equal(FileIndex.ignoreLine(HOME, `${HOME}/Applications/UnrealEngine`), "/Applications/UnrealEngine/")
  assert.equal(FileIndex.ignoreLine(HOME, `${HOME}/Games/Foo [GOG]`), "/Games/Foo \\[GOG\\]/")
  assert.equal(FileIndex.ignoreLine(HOME, `${HOME}/a*b/[x]?`), "/a\\*b/\\[x\\]\\?/")
  assert.equal(FileIndex.ignoreLine(HOME, `${HOME}/br{a,b}ce`), "/br\\{a,b\\}ce/")
  assert.equal(FileIndex.ignoreLine(HOME, `${HOME}/back\\slash`), "/back\\\\slash/")
  assert.equal(FileIndex.ignoreLine(HOME, `${HOME}/trail `), "/trail /")
  assert.equal(FileIndex.ignoreFileText([{ path: `${HOME}/x`, count: 9 }, { path: `${HOME}/y z`, count: 7 }], HOME), "/x/\n/y z/\n")
  assert.equal(FileIndex.ignoreFileText([], HOME), "")
})

const GLOB_NAMES = ["Games/Foo [GOG]", "a[b", "x]y", "q?x", "st*r", "trail ", "back\\slash", "br{a,b}ce", "!bang", "#hash", "Dev/a b/c"]

test("ignores reads back every line ignoreLine writes, and nothing next to it", () => {
  for (const name of GLOB_NAMES) {
    const line = FileIndex.ignoreLine(HOME, `${HOME}/${name}`) + "\n"
    assert.equal(FileIndex.ignores(line, HOME, `${HOME}/${name}`), true, line)
    assert.equal(FileIndex.ignores(line, HOME, `${HOME}/${name}/inner`), true, line)
    assert.equal(FileIndex.ignores(line, HOME, `${HOME}/${name}x`), false, line)
  }
  assert.equal(FileIndex.ignores(FileIndex.ignoreLine(HOME, `${HOME}/q?x`), HOME, `${HOME}/qax`), false)
  assert.equal(FileIndex.ignores(FileIndex.ignoreLine(HOME, `${HOME}/st*r`), HOME, `${HOME}/stuffr`), false)
  assert.equal(FileIndex.ignores(FileIndex.ignoreLine(HOME, `${HOME}/Games/Foo [GOG]`), HOME, `${HOME}/Games/Foo G`), false)
})

test("ignores never throws: a line rg rejects matches nothing, and the lines around it still count", () => {
  const text = "/b{oops/\nx}y\nfoo\\\n/Games/Foo [GOG]/\n/a[b/\n{c,{d}}/\n/Applications/UnrealEngine/\n"
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/b{oops`), false)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/Games/Foo G`), true)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/Games/Foo [GOG]`), false)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/a[b`), true)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/x/d`), true)
  assert.equal(FileIndex.ignores(text, HOME, `${HOME}/Applications/UnrealEngine`), true)
  assert.deepEqual(FileIndex.badIgnoreLines(text), ["/b{oops/", "x}y", "foo\\"])
  assert.deepEqual(FileIndex.badIgnoreLines(FileIndex.defaultIgnoreText()), [])
})

test("treeToAsk skips ignored trees and asks again after seven days", () => {
  const trees = [{ path: `${HOME}/node_modules`, count: 12558 }, { path: `${HOME}/Applications/UnrealEngine`, count: 300136 }]
  const now = Date.UTC(2026, 10, 4)
  const ignoreText = FileIndex.defaultIgnoreText()
  assert.deepEqual(FileIndex.treeToAsk(trees, {}, ignoreText, HOME, now), trees[1])
  const askedAt = { [`${HOME}/Applications/UnrealEngine`]: now - 6 * 86400000 }
  assert.equal(FileIndex.treeToAsk(trees, askedAt, ignoreText, HOME, now), null)
  askedAt[`${HOME}/Applications/UnrealEngine`] = now - 7 * 86400000
  assert.deepEqual(FileIndex.treeToAsk(trees, askedAt, ignoreText, HOME, now), trees[1])
  assert.equal(FileIndex.treeToAsk(trees, {}, ignoreText + "/Applications/UnrealEngine/\n", HOME, now), null)
})

test("toastFor names the tree with its file count and offers the ignore call", () => {
  assert.deepEqual(FileIndex.toastFor({ path: `${HOME}/Applications/UnrealEngine`, count: 300136 }, HOME, "files.ignore"), {
    style: "success",
    title: "Skipping ~/Applications/UnrealEngine (300,136 files)",
    actions: [{
      id: "add-to-ignore-file", title: "Add to Ignore File", done: "Added ~/Applications/UnrealEngine to the ignore file",
      call: { method: "files.ignore", data: { path: `${HOME}/Applications/UnrealEngine` } }
    }]
  })
})

const hasRg = spawnSync("rg", ["--version"]).status === 0

test("rg honours the default ignore file and an appended tree, run from the home dir", { skip: !hasRg && "rg is not installed" }, (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-files-"))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const files = [
    "Documents/plan.md", "Dev/app/node_modules/react/index.js", "Applications/UnrealEngine/Engine/x.so",
    "Other/Applications/UnrealEngine/keep.txt", ".ssh/id_ed25519", ".config/hypr/hyprland.lua",
    ".config/chromium/Default/Cookies", ".config/Code/Cache/data_0", "Dev/app/.env.local"
  ]
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(home, f)), { recursive: true })
    fs.writeFileSync(path.join(home, f), "x")
  }
  const ignore = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "omacast-ignore-")), "file-search.ignore")
  t.after(() => fs.rmSync(path.dirname(ignore), { recursive: true, force: true }))
  fs.writeFileSync(ignore, FileIndex.defaultIgnoreText() + FileIndex.ignoreLine(home, home + "/Applications/UnrealEngine") + "\n")
  const list = (args) => spawnSync("rg", args, { cwd: home, encoding: "utf8" }).stdout.split("\n").filter(Boolean).sort()
  assert.deepEqual(list(["--files", "--ignore-file", ignore, home]), [
    `${home}/Documents/plan.md`, `${home}/Other/Applications/UnrealEngine/keep.txt`
  ])
  assert.deepEqual(list(["--files", "--hidden", "--ignore-file", ignore, home + "/.config"]), [`${home}/.config/hypr/hyprland.lua`])
})

test("rg leaves out every tree ignoreLine writes, glob characters and all", { skip: !hasRg && "rg is not installed" }, (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-globs-"))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const decoys = ["qax", "stuffr", "Games/Foo G", "brace"]
  for (const name of [...GLOB_NAMES, ...decoys]) {
    fs.mkdirSync(path.join(home, name), { recursive: true })
    fs.writeFileSync(path.join(home, name, "f"), "x")
  }
  const ignore = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "omacast-globs-ignore-")), "file-search.ignore")
  t.after(() => fs.rmSync(path.dirname(ignore), { recursive: true, force: true }))
  fs.writeFileSync(ignore, FileIndex.ignoreFileText(GLOB_NAMES.map((n) => ({ path: `${home}/${n}`, count: 1 })), home))
  const r = spawnSync("rg", ["--files", "--ignore-file", ignore, home], { cwd: home, encoding: "utf8" })
  assert.equal(r.stderr, "")
  assert.deepEqual(r.stdout.split("\n").filter(Boolean).sort(), decoys.map((d) => `${home}/${d}/f`).sort())
})
