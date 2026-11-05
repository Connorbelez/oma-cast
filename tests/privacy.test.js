const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawn, spawnSync } = require("node:child_process")
const Paths = require("../core/Paths.js")

// Marketplace review: histories must stay private under a normal umask 022,
// with every ancestor traversable, and no private text may reach any argv.
const root = path.join(__dirname, "..")
const mode = (p) => fs.statSync(p).mode & 0o777

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-privacy-"))
  fs.chmodSync(home, 0o755)
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

function runSetup(home) {
  const p = Paths.resolve((name) => ({ HOME: home, XDG_RUNTIME_DIR: home + "/run" })[name] || "")
  fs.mkdirSync(home + "/run", { mode: 0o755 })
  const files = ["settings.json", "frecency.json", "calculator.json"].map((f) => p.db + "/" + f)
  const [cmd, ...args] = Paths.setupArgv(p, files)
  const r = spawnSync("bash", ["-c", "umask 022; exec \"$@\"", "umask-022", cmd, ...args], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  return p
}

test("first start under umask 022 creates owner-only dirs and 0600 store files", (t) => {
  const p = runSetup(tempHome(t))
  for (const dir of Paths.privateRoots(p)) assert.equal(mode(dir), 0o700, dir)
  for (const dir of Paths.directoriesToCreate(p)) assert.equal(mode(dir), 0o700, dir)
  for (const f of ["settings.json", "frecency.json", "calculator.json"]) assert.equal(mode(p.db + "/" + f), 0o600, f)
})

test("an atomic save into a pre-created file keeps it private", (t) => {
  const p = runSetup(tempHome(t))
  // QSaveFile copies the target's permissions onto its temp file before the rename.
  const target = p.db + "/frecency.json"
  const temp = target + ".tmp"
  fs.writeFileSync(temp, '{"searchHistory":["secret"]}', { mode: 0o644 })
  fs.chmodSync(temp, mode(target))
  fs.renameSync(temp, target)
  assert.equal(mode(target), 0o600)
})

test("readable histories from older builds are repaired; stricter modes are kept", (t) => {
  const home = tempHome(t)
  const db = home + "/.local/share/omacast/db"
  fs.mkdirSync(db, { recursive: true, mode: 0o755 })
  fs.chmodSync(home + "/.local/share/omacast", 0o755)
  fs.writeFileSync(db + "/frecency.json", "{}", { mode: 0o644 })
  fs.writeFileSync(db + "/calculator.json", "{}", { mode: 0o644 })
  fs.writeFileSync(db + "/settings.json", "{}")
  fs.chmodSync(db + "/frecency.json", 0o644)
  fs.chmodSync(db + "/calculator.json", 0o664)
  fs.chmodSync(db + "/settings.json", 0o400)
  const p = runSetup(home)
  assert.equal(mode(p.data), 0o700)
  assert.equal(mode(p.db), 0o700)
  assert.equal(mode(db + "/frecency.json"), 0o600)
  assert.equal(mode(db + "/calculator.json"), 0o600)
  assert.equal(mode(db + "/settings.json"), 0o400)
  assert.equal(fs.readFileSync(db + "/frecency.json", "utf8"), "{}", "repair never rewrites contents")
})

test("legacy oma-cast data moves and comes out private", (t) => {
  const home = tempHome(t)
  const old = home + "/.local/share/oma-cast/db"
  fs.mkdirSync(old, { recursive: true })
  fs.chmodSync(home + "/.local/share/oma-cast", 0o755)
  fs.writeFileSync(old + "/calculator.json", '{"history":[]}', { mode: 0o644 })
  fs.chmodSync(old + "/calculator.json", 0o644)
  const p = runSetup(home)
  assert.ok(!fs.existsSync(home + "/.local/share/oma-cast"))
  assert.equal(mode(p.data), 0o700)
  assert.equal(mode(p.db + "/calculator.json"), 0o600)
})

test("setup hyprland keeps a private legacy oma-cast.lua private", (t) => {
  const home = tempHome(t)
  const hypr = home + "/.config/hypr"
  const bin = home + "/bin"
  fs.mkdirSync(hypr, { recursive: true })
  fs.mkdirSync(bin)
  fs.mkdirSync(home + "/omarchy")
  fs.writeFileSync(hypr + "/hyprland.lua", 'require("hypr.oma-cast")\n')
  fs.writeFileSync(hypr + "/oma-cast.lua", 'o.bind("ALT + SPACE", "oma-cast launcher", hl.dsp.global("oma-cast:toggle"))\n-- token = "private"\n')
  fs.chmodSync(hypr + "/oma-cast.lua", 0o600)
  fs.writeFileSync(bin + "/hyprctl", "#!/bin/bash\nexit 0\n", { mode: 0o755 })
  const r = spawnSync("bash", ["-c", 'umask 022; exec "$@"', "umask-022", path.join(root, "bin/omacast"), "setup", "hyprland", "--yes"], {
    env: { HOME: home, XDG_CONFIG_HOME: home + "/.config", OMARCHY_PATH: home + "/omarchy", PATH: bin + ":" + process.env.PATH },
    encoding: "utf8"
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!fs.existsSync(hypr + "/oma-cast.lua"))
  assert.equal(mode(hypr + "/omacast.lua"), 0o600)
  assert.match(fs.readFileSync(hypr + "/omacast.lua", "utf8"), /omacast:toggle/)
})

// The clipboard scripts run with the text on stdin. A fake wl-copy/wtype on
// PATH records each process's /proc cmdline while the text is in flight.
function clipboardScripts() {
  const source = fs.readFileSync(path.join(root, "services/ClipboardWriter.qml"), "utf8")
  const grab = (name) => source.match(new RegExp("property string " + name + ": '([^']*)'"))[1]
  return { copy: grab("copyScript"), paste: grab("pasteScript") }
}

for (const kind of ["copy", "paste"]) {
  test(`calculator ${kind} keeps the text out of every command line`, (t) => {
    const home = tempHome(t)
    const log = home + "/cmdlines"
    const fake = '#!/bin/bash\ntr "\\0" " " </proc/$$/cmdline >>"$LOG"; echo >>"$LOG"\n'
    fs.writeFileSync(home + "/wl-copy", fake + 'cat >"$LOG.clipboard"\n', { mode: 0o755 })
    fs.writeFileSync(home + "/wtype", fake, { mode: 0o755 })
    fs.writeFileSync(home + "/sleep", "#!/bin/bash\nexit 0\n", { mode: 0o755 })
    const secret = "1234 * 5678 = 7006652 my private question"
    const script = clipboardScripts()[kind]
    const r = spawnSync("bash", ["-c", script], {
      input: secret, encoding: "utf8",
      env: { ...process.env, LOG: log, PATH: home + ":" + process.env.PATH }
    })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(fs.readFileSync(log + ".clipboard", "utf8"), secret)
    const cmdlines = fs.readFileSync(log, "utf8")
    assert.ok(!cmdlines.includes("private"), cmdlines)
    assert.ok(!script.includes("$"), "the script takes no arguments")
    if (kind === "paste") assert.match(cmdlines, /wtype -M shift -k Insert -m shift/)
  })
}

test("no QML hands clipboard text or prompts to a process's argv", () => {
  const files = ["Backend.qml", "Launcher.qml", ...["ui", "services"].flatMap((d) =>
    fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".qml")).map((f) => d + "/" + f))]
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8")
    assert.doesNotMatch(source, /\["wl-copy"|omarchy-clipboard-paste-text"|omarchy-agent/, file)
  }
})

// File search: rg gets flags, roots and omacast's own ignore files, nothing a
// user typed. Every element of every `command:` array in FileLister.qml must be
// a quoted literal or one of these properties.
const FILE_LISTER_ARGS = {
  "lister.home": "the home root",
  "homeRun.root": "a root, absolute (Backend.checkFilePath)",
  "configRun.root": "a root, absolute (Backend.checkFilePath)",
  "lister.ignoreFile": "~/.config/omacast/file-search.ignore",
  "lister.untouchedFile": "the large untouched subtrees, as ignore patterns",
  "lister.listScript": "a constant script",
  "lister.signalsScript": "a constant script",
  "lister.writeScript": "a constant script",
  "FileIndex.RECOUNT_SCRIPT": "a constant script",
  "FileIndex.COUNT_PROGRAM": "a constant awk program",
  "String(FileIndex.DEFAULT_THRESHOLD)": "a constant number",
  "writer.mode": "create, append or replace",
  "writer.path": "one of omacast's own files"
}

function fileListerSource() {
  return fs.readFileSync(path.join(root, "services/FileLister.qml"), "utf8")
}

test("every process FileLister starts has fixed argv", () => {
  const source = fileListerSource()
  const commands = [...source.matchAll(/command:\s*\[([^\]]*)\]/g)].map((m) => m[1].split(",").map((s) => s.trim()))
  assert.equal(commands.length, 5)
  for (const argv of commands) {
    for (const arg of argv) assert.ok(/^"[^"$`\\]*"$/.test(arg) || arg in FILE_LISTER_ARGS, `${arg} in [${argv}]`)
  }
  const saves = [...source.matchAll(/lister\.save\(([^,]+),\s*([^,]+),/g)].map((m) => [m[1].trim(), m[2].trim()])
  assert.ok(saves.length >= 4)
  for (const [mode, file] of saves) {
    assert.match(mode, /^"(create|append|replace)"$/)
    assert.ok(["lister.ignoreFile", "lister.untouchedFile", "lister.stateFile"].includes(file), file)
  }
})

function fileListerScript(name) {
  const source = fileListerSource()
  const single = source.match(new RegExp("property string " + name + ": '([^']*)'"))
  if (single) return single[1]
  return JSON.parse(source.match(new RegExp("property string " + name + ': ("(?:[^"\\\\]|\\\\.)*")'))[1])
}

test("the file-search write script makes 0600 files under umask 022 and never clobbers on create", (t) => {
  const home = tempHome(t)
  const script = fileListerScript("writeScript")
  const run = (mode, file, input) => spawnSync("bash", ["-c", 'umask 022; exec bash -c "$@"', "umask-022", script, "omacast-files", mode, file], { input, encoding: "utf8" })
  const file = home + "/file-search.ignore"
  assert.equal(run("create", file, "node_modules/\n").status, 0)
  assert.equal(run("create", file, "overwritten\n").status, 0)
  assert.equal(run("append", file, "/Applications/UnrealEngine/\n").status, 0)
  assert.equal(fs.readFileSync(file, "utf8"), "node_modules/\n/Applications/UnrealEngine/\n")
  assert.equal(mode(file), 0o600)
  const state = home + "/file-search.json"
  assert.equal(run("replace", state, "{}\n").status, 0)
  assert.equal(run("replace", state, '{"files":1}\n').status, 0)
  assert.equal(fs.readFileSync(state, "utf8"), '{"files":1}\n')
  assert.equal(mode(state), 0o600)
  assert.deepEqual(fs.readdirSync(home).sort(), ["file-search.ignore", "file-search.json"])
  assert.notEqual(run("delete", state, "").status, 0)
})

test("a write never goes through a .tmp a killed write left behind", (t) => {
  const home = tempHome(t)
  const script = fileListerScript("writeScript")
  const run = (mode, file, input) => spawnSync("bash", ["-c", 'umask 022; exec bash -c "$@"', "umask-022", script, "omacast-files", mode, file], { input, encoding: "utf8" })
  const victim = home + "/victim"
  fs.writeFileSync(victim, "keep\n", { mode: 0o644 })
  for (const [kind, name] of [["replace", "file-search.json"], ["create", "file-search.ignore"]]) {
    const file = `${home}/${name}`
    fs.symlinkSync(victim, file + ".tmp")
    assert.equal(run(kind, file, "new\n").status, 0, kind)
    assert.equal(fs.lstatSync(file).isFile(), true, kind)
    assert.equal(fs.readFileSync(file, "utf8"), "new\n", kind)
    assert.equal(mode(file), 0o600, kind)
    assert.equal(fs.readFileSync(victim, "utf8"), "keep\n", kind)
  }
  assert.deepEqual(fs.readdirSync(home).sort(), ["file-search.ignore", "file-search.json", "victim"])
})

test("a create killed before its content arrives leaves no file behind for the next create to skip", async (t) => {
  const home = tempHome(t)
  const file = home + "/file-search.ignore"
  const script = fileListerScript("writeScript")
  const child = spawn("bash", ["-c", script, "omacast-files", "create", file], { stdio: ["pipe", "ignore", "ignore"], detached: true })
  const exited = new Promise((resolve) => child.on("exit", resolve))
  for (let i = 0; i < 200 && !fs.readdirSync(home).length; i++) await new Promise((r) => setTimeout(r, 10))
  assert.ok(fs.readdirSync(home).length, "the redirect ran")
  process.kill(-child.pid, "SIGKILL")
  await exited
  assert.equal(fs.existsSync(file), false)
  const r = spawnSync("bash", ["-c", script, "omacast-files", "create", file], { input: "node_modules/\n", encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.readFileSync(file, "utf8"), "node_modules/\n")
  assert.equal(mode(file), 0o600)
  assert.deepEqual(fs.readdirSync(home), ["file-search.ignore"])
})

// rg lists every file, private paths included, when an --ignore-file is
// missing or unreadable, and still exits 0.
test("the list script runs rg with fixed flags only while both ignore files are readable", (t) => {
  const home = tempHome(t)
  const log = home + "/cmdlines"
  fs.writeFileSync(home + "/rg", '#!/bin/bash\necho "$*" >>"$LOG"\n', { mode: 0o755 })
  const ignore = home + "/file-search.ignore"
  const untouched = home + "/file-search-untouched.ignore"
  fs.writeFileSync(ignore, ".ssh/\n")
  fs.writeFileSync(untouched, "")
  const list = (...args) => spawnSync("bash", ["-c", fileListerScript("listScript"), "omacast-files", ...args], {
    encoding: "utf8", env: { ...process.env, LOG: log, PATH: home + ":" + process.env.PATH }
  }).status
  assert.equal(list("/home/u", ignore, untouched), 0)
  assert.equal(list("/home/u/.config", ignore, untouched, "--hidden"), 0)
  fs.mkdirSync(home + "/dir.ignore")
  assert.equal(list("/home/u", home + "/dir.ignore", untouched), 3)
  if (process.getuid() !== 0) {
    fs.chmodSync(untouched, 0o000)
    assert.equal(list("/home/u", ignore, untouched), 3)
  }
  fs.rmSync(untouched)
  fs.mkdirSync(untouched)
  assert.equal(list("/home/u", ignore, untouched), 3)
  fs.rmSync(ignore)
  assert.equal(list("/home/u/.config", ignore, home + "/rg", "--hidden"), 3)
  assert.equal(fs.readFileSync(log, "utf8"), [
    `--files --ignore-file ${ignore} --ignore-file ${untouched} /home/u`,
    `--files --hidden --ignore-file ${ignore} --ignore-file ${untouched} /home/u/.config`,
    ""
  ].join("\n"))
})

test("the usage-signal script passes only fixed flags and the home dir to zoxide and fd", (t) => {
  const home = tempHome(t)
  const log = home + "/cmdlines"
  const fake = '#!/bin/bash\ntr "\\0" " " </proc/$$/cmdline >>"$LOG"; echo >>"$LOG"\n'
  fs.writeFileSync(home + "/zoxide", fake + 'echo "  2.0 /home/u/Dev"\n', { mode: 0o755 })
  fs.writeFileSync(home + "/fd", fake + 'echo "/home/u/Work/repo/.git/logs/HEAD"\n', { mode: 0o755 })
  const r = spawnSync("bash", ["-c", fileListerScript("signalsScript"), "omacast-signals", "/home/u"], {
    encoding: "utf8", env: { ...process.env, LOG: log, PATH: home + ":" + process.env.PATH }
  })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, "  2.0 /home/u/Dev\n/home/u/Work/repo/.git/logs/HEAD\n")
  assert.deepEqual(fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => l.trim().replace(/^\/bin\/bash \S+\/(\w+)/, "$1")), [
    "zoxide query --list --score",
    "fd -H -t f -p /\\.git/logs/HEAD$ --changed-within 14d --max-depth 8 --exclude node_modules /home/u"
  ])
})

// rg anchors --ignore-file patterns at its working directory, and a path
// fd prints relative to some other directory never matches a tree. A
// FIFO or a hung mount blocks rg and fd, and only timeout's process group
// reaches the pipeline and fd behind bash.
test("every process that walks the home dir starts in it, under timeout", () => {
  const blocks = fileListerSource().split("\n  Process {").slice(1).map((b) => b.split("\n  }")[0])
  const walkers = blocks.filter((b) => /command:.*(listScript|signalsScript|RECOUNT_SCRIPT)/.test(b))
  assert.equal(walkers.length, 4)
  for (const b of walkers) {
    assert.match(b, /\n    workingDirectory: lister\.home\n/, b.split("\n")[1])
    assert.match(b, /\n    command: \["timeout", "-k", "2", "(15|60)", "bash", "-c", /, b.split("\n")[1])
  }
})

// File actions: every process gets the file's own path from a listed row,
// fixed flags and constant scripts, never the query.
const FILE_ACTION_ARGS = {
  "actions.previewScript": "a constant script",
  "previewRun.path": "a listed file (FileActions.listedPath)",
  "previewRun.mode": "a preview mode from the file's extension",
  "previewRun.limit": "a constant byte limit",
  "trashRun.path": "a listed file under the home dir (FileActions.trashPath)",
  "dir": "a listed file's folder",
  "desktopId": "an installed app's desktop id",
  "path": "a listed file"
}

test("every process FileActions starts has fixed argv", () => {
  const source = fs.readFileSync(path.join(root, "services/FileActions.qml"), "utf8")
  const argvs = [...source.matchAll(/(?:command:\s*|execArgv\()\[([^\]]*)\]/g)].map((m) => m[1].split(",").map((s) => s.trim()))
  assert.equal(argvs.length, 4)
  for (const argv of argvs) {
    for (const arg of argv) assert.ok(/^"[^"$`\\]*"$/.test(arg) || arg in FILE_ACTION_ARGS, `${arg} in [${argv}]`)
  }
  assert.doesNotMatch(source, /execDetached|command:(?!\s*\[)|\.command\s*=/)
  assert.match(source, /\n    command: \["timeout", "-k", "2", "10", "bash", "-c", actions\.previewScript, /)
})

// A script property that concatenates anything, such as the query, is no
// longer the constant script FILE_ACTION_ARGS allows.
test("every script FileActions runs is one string literal", () => {
  const source = fs.readFileSync(path.join(root, "services/FileActions.qml"), "utf8")
  const scripts = source.split("\n").filter((line) => /property string \w*[Ss]cript\b/.test(line))
  assert.ok(scripts.length >= 1)
  for (const line of scripts) assert.match(line, /^  readonly property string \w+: '(?:[^'\\]|\\.)*'$/, line.slice(0, 80))
})

// Content search: rg gets fixed flags, the two roots and omacast's ignore
// files. The query goes to the script on stdin and reaches rg on stdin.
const CONTENT_ARGS = {
  "service.searchScript": "a constant script",
  "run.homeRoot": "the home root (FileLister.defaultRoots)",
  "run.configRoot": "~/.config (FileLister.defaultRoots)",
  "service.ignoreFile": "~/.config/omacast/file-search.ignore",
  "service.untouchedFile": "the large untouched subtrees, as ignore patterns"
}

function contentSource() {
  return fs.readFileSync(path.join(root, "services/ContentSearch.qml"), "utf8")
}

function contentScript() {
  const line = contentSource().split("\n").find((l) => l.startsWith("  readonly property string searchScript: '"))
  return new Function("return " + line.slice(line.indexOf("'")))()
}

test("ContentSearch starts one fixed argv from the home dir and writes the query to stdin", () => {
  const source = contentSource()
  const commands = [...source.matchAll(/command:\s*\[([^\]]*)\]/g)].map((m) => m[1].split(",").map((s) => s.trim()))
  assert.equal(commands.length, 1)
  assert.deepEqual(commands[0].slice(0, 8), ['"timeout"', '"-k"', '"2"', '"5"', '"bash"', '"-c"', "service.searchScript", '"omacast-content"'])
  for (const arg of commands[0]) assert.ok(/^"[^"$`\\]*"$/.test(arg) || arg in CONTENT_ARGS, `${arg} in [${commands[0]}]`)
  assert.doesNotMatch(source, /execDetached|execArgv|\.command\s*=|command:(?!\s*\[)/)
  assert.match(source, /\n    workingDirectory: service\.home\n/)
  assert.match(source, /onStarted: \{\s*run\.write\(run\.request\.query \+ "\\n"\)\s*run\.stdinEnabled = false\s*\}/)
  const scripts = source.split("\n").filter((line) => /property string \w*[Ss]cript\b/.test(line))
  assert.deepEqual(scripts.map((line) => /^  readonly property string searchScript: '(?:[^'\\]|\\.)*'$/.test(line)), [true])
  for (const call of source.match(/service\.message\([^\n]*/g)) assert.doesNotMatch(call, /query/, call)
})

function fakeContentRg(home, body) {
  fs.writeFileSync(home + "/rg", [
    "#!/bin/bash",
    'tr "\\0" " " </proc/$$/cmdline >>"$LOG"; echo >>"$LOG"',
    'tr "\\0" " " </proc/$PPID/cmdline >>"$LOG.parents"; echo >>"$LOG.parents"',
    'cat >>"$LOG.stdin"',
    body
  ].join("\n") + "\n", { mode: 0o755 })
}

function runContentScript(home, input, ignore, untouched) {
  return spawnSync("bash", ["-c", contentScript(), "omacast-content", "/home/u", "/home/u/.config", ignore, untouched], {
    input, encoding: "utf8", env: { ...process.env, LOG: home + "/cmdlines", PATH: home + ":" + process.env.PATH }
  })
}

test("the content script gives rg the query on stdin only and passes on short match lines", (t) => {
  const home = tempHome(t)
  const ignore = home + "/file-search.ignore"
  const untouched = home + "/file-search-untouched.ignore"
  fs.writeFileSync(ignore, ".ssh/\n")
  fs.writeFileSync(untouched, "")
  const long = JSON.stringify({ type: "match", data: { path: { text: "/home/u/min.js" }, lines: { text: "x".repeat(5000) } } })
  fakeContentRg(home, [
    `echo '{"type":"begin","data":{}}'`,
    `echo '{"type":"match","data":{"path":{"text":"'"\${@: -1}"'/a.md"}}}'`,
    `echo '${long}'`,
    `echo '{"data":{},"type":"summary"}'`
  ].join("\n"))
  const r = runContentScript(home, "my secret query\n", ignore, untouched)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '{"type":"match","data":{"path":{"text":"/home/u/a.md"}}}\n{"type":"match","data":{"path":{"text":"/home/u/.config/a.md"}}}\n')
  const log = home + "/cmdlines"
  assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n").map((l) => l.trim().replace(/^\/bin\/bash \S+\/rg /, "rg ")).sort(), [
    `rg --json -F -i -f - --max-count 1 --max-filesize 1M -j 32 --hidden --ignore-file ${ignore} --ignore-file ${untouched} /home/u/.config`,
    `rg --json -F -i -f - --max-count 1 --max-filesize 1M -j 32 --ignore-file ${ignore} --ignore-file ${untouched} /home/u`
  ])
  assert.equal(fs.readFileSync(log + ".stdin", "utf8"), "my secret query\nmy secret query\n")
  const parents = fs.readFileSync(log + ".parents", "utf8")
  assert.match(parents, /omacast-content \/home\/u \/home\/u\/\.config/)
  assert.ok(!parents.includes("secret"), parents)
})

test("the content script runs no rg without both ignore files or with an empty query, and passes on at most 1,000 files", (t) => {
  const home = tempHome(t)
  const ignore = home + "/file-search.ignore"
  const untouched = home + "/file-search-untouched.ignore"
  fs.writeFileSync(ignore, ".ssh/\n")
  fs.writeFileSync(untouched, "")
  fakeContentRg(home, `for i in $(seq 1500); do echo '{"type":"match","data":{"line_number":'$i'}}'; done`)
  assert.equal(runContentScript(home, "frec\n", ignore, home + "/missing.ignore").status, 3)
  fs.mkdirSync(home + "/dir.ignore")
  assert.equal(runContentScript(home, "frec\n", home + "/dir.ignore", untouched).status, 3)
  assert.equal(runContentScript(home, "\n", ignore, untouched).status, 2)
  assert.equal(runContentScript(home, "", ignore, untouched).status, 2)
  assert.equal(fs.existsSync(home + "/cmdlines"), false)
  const r = runContentScript(home, "frec\n", ignore, untouched)
  assert.equal(r.status, 0, r.stderr)
  const lines = r.stdout.trim().split("\n")
  assert.deepEqual([lines.length, lines[0], lines[999]], [1000, '{"type":"match","data":{"line_number":1}}', '{"type":"match","data":{"line_number":1000}}'])
})
