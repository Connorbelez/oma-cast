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

test("largeSubtrees returns the untouched vendor tree and keeps the signalled one", () => {
  const paths = fixture()
  assert.equal(paths.length, 40)
  assert.deepEqual(FileIndex.largeSubtrees(paths, [`${HOME}/Dev/app`], 5, HOME), [
    { path: `${HOME}/Applications`, count: 6 }
  ])
})

test("largeSubtrees descends into a touched tree and flags the topmost untouched one", () => {
  const paths = fixture()
  assert.deepEqual(FileIndex.largeSubtrees(paths, [`${HOME}/Dev/app`, `${HOME}/Applications/notes`], 5, HOME), [
    { path: `${HOME}/Applications/Engine`, count: 6 }
  ])
})

test("largeSubtrees never flags the root, even with no signals at all", () => {
  const paths = fixture()
  assert.equal(paths.length, 40)
  assert.deepEqual(FileIndex.largeSubtrees(paths.concat(paths.map((p) => p + ".bak")), [], 5, HOME), [
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

test("largeSubtrees keeps a tree at the threshold and ignores paths outside the root", () => {
  const paths = [1, 2, 3, 4, 5].map((i) => `${HOME}/small/f${i}`).concat(["/etc/a/b", "/etc/a/c"])
  assert.deepEqual(FileIndex.largeSubtrees(paths, [], 5, HOME), [])
})

test("parseList splits rg output into path, name and dir", () => {
  assert.deepEqual(FileIndex.parseList(`${HOME}/a/b.txt\n${HOME}/c\n`), [
    { path: `${HOME}/a/b.txt`, name: "b.txt", dir: `${HOME}/a` },
    { path: `${HOME}/c`, name: "c", dir: HOME }
  ])
  assert.deepEqual(FileIndex.parseList(""), [])
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

test("ignoreLine anchors the tree to the root and escapes glob characters", () => {
  assert.equal(FileIndex.ignoreLine(HOME, `${HOME}/Applications/UnrealEngine`), "/Applications/UnrealEngine/")
  assert.equal(FileIndex.ignoreLine(HOME, `${HOME}/a*b/[x]?`), "/a\\*b/\\[x]\\?/")
  assert.equal(FileIndex.ignoreFileText([{ path: `${HOME}/x`, count: 9 }, { path: `${HOME}/y z`, count: 7 }], HOME), "/x/\n/y z/\n")
  assert.equal(FileIndex.ignoreFileText([], HOME), "")
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
    title: "Skipping ~/Applications/UnrealEngine (300,136 files, untouched). Add to ignore file?",
    actions: [{
      id: "add-to-ignore-file", title: "Add to Ignore File", done: "Added ~/Applications/UnrealEngine to the ignore file",
      call: { method: "files.ignore", data: { path: `${HOME}/Applications/UnrealEngine` } }
    }]
  })
})

test("chunks splits on newlines below the size and rejoins to the original", () => {
  const text = "aaaa\nbb\ncccccc\nd\n"
  const parts = FileIndex.chunks(text, 6)
  assert.deepEqual(parts, ["aaaa\n", "bb\n", "cccccc\n", "d\n"])
  assert.equal(parts.join(""), text)
  assert.deepEqual(FileIndex.chunks("a-long-line\nb\n", 4), ["a-long-line\n", "b\n"])
  assert.deepEqual(FileIndex.chunks("no-newline", 4), ["no-newline"])
  assert.deepEqual(FileIndex.chunks("", 6), [])
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
