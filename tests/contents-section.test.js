const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const Rows = require("../core/Rows.js")
const FileRanker = require("../core/FileRanker.js")

// The Search Files view's own functions from ui/LauncherWindow.qml, run
// against stand-ins for the ListModel, the ListView, the timers and the
// backend. The backend answers the name search synchronously, as the files
// view does, from the names the test lists, and keeps the content callback
// for the test to answer.
const FUNCTIONS = ["rebuild", "keepsContents", "applySearch", "withContents", "indexOfRow", "cancelContents", "searchContents",
  "applyContents", "applyHeld", "afterCut", "rowData", "isSelectable", "nextSelectable", "select"]

function launcher(files) {
  const source = fs.readFileSync(path.join(__dirname, "../ui/LauncherWindow.qml"), "utf8")
  const records = []
  const rows = {
    get count() { return records.length },
    get: (i) => records[i],
    set: (i, r) => { records[i] = Object.assign({}, r) },
    remove: (at, n) => records.splice(at, n),
    append: (list) => list.forEach((r) => records.push(Object.assign({}, r)))
  }
  const timer = { running: false, restart() { this.running = true }, stop() { this.running = false } }
  const list = { itemAtIndex: () => null, positionViewAtIndex() {}, positionViewAtBeginning() {} }
  const backend = {
    list: files.map((p) => ({ path: p, name: p.slice(p.lastIndexOf("/") + 1), dir: p.slice(0, p.lastIndexOf("/")) })),
    names: [],
    filesRevision: 0,
    candidatesRevision: 0,
    content: null,
    log() {},
    cancelSearch() {},
    cancelContents() { backend.content = null; return false },
    searchAsync(data, callback) {
      const listed = backend.names.filter((n) => backend.list.some((r) => r.path === n.path))
      callback({ ok: true, data: listed.length ? [{ id: "files", title: "Files", rows: listed.map((n) => ({ id: "file:" + n.path, title: n.path, path: n.path, loose: n.loose })) }] : [] })
    },
    searchContents(data, callback) { backend.content = { query: data.query, serial: data.serial, callback }; return true },
    listedFiles: (items) => FileRanker.listed(items, backend.list)
  }
  const window = {
    view: { kind: "files" }, filesView: true, atRoot: false, rootFilter: "all", query: "", shown: true, layerOpen: false, contentsForced: false,
    contents: { view: null, query: "", rows: [], held: null, revision: -1 }, nameRows: [], searchSerial: 0, searchPending: false,
    selectedIndex: -1, selectedRow: null, selectionAuto: false, argsForId: "", argValues: {}, argFocus: -1, argDefs: [], rebuiltAt: 0, contentsShownAt: 0,
    backend
  }
  const context = vm.createContext({ window, rows, list, contentDelay: timer, pointerGate: { reset() {} }, ListView: { Contain: 0 }, Rows, Date, JSON, Object })
  for (const name of FUNCTIONS) {
    const start = source.indexOf("  function " + name + "(")
    if (start < 0) continue
    vm.runInContext(source.slice(start, source.indexOf("\n  }", start) + 4).trim(), context)
    window[name] = context[name]
  }
  const label = (r) => r.rowKind === "section" ? "#" + r.itemId.slice("section:".length) : r.itemId.slice("file:".length) + (r.inContents ? "*" : "")
  return {
    window, backend, timer,
    // What the view shows: its rows, the selected one, and whether a content
    // search is due or running.
    state: () => `rows=${records.map(label).join(" ")} sel=${window.selectedIndex < 0 ? "none" : label(records[window.selectedIndex])}`,
    type(query) { window.query = query; window.rebuild(true) },
    fire() { timer.running = false; window.searchContents() },
    reply(paths) {
      const pending = backend.content
      backend.content = null
      pending.callback({ serial: pending.serial, revision: backend.filesRevision,
        rows: paths.map((p) => ({ id: "file:" + p, title: p, path: p, kind: "file" })) })
    },
    choose(label_) { window.select(records.findIndex((r) => label(r) === label_)) },
    drop(p) { backend.list = backend.list.filter((r) => r.path !== p); backend.filesRevision++; window.rebuild(false) }
  }
}

test("when every name row is loose, the automatic selection moves to the first Contents row and a chosen one to none", () => {
  const v = launcher(["/h/l1", "/h/l2", "/h/c1"])
  v.backend.names = [{ path: "/h/l1", loose: true }, { path: "/h/l2", loose: true }]
  v.type("q")
  v.fire()
  v.reply(["/h/c1"])
  assert.equal(v.state(), "rows=#contents /h/c1* sel=/h/c1*")
  v.type("qq")
  v.choose("/h/l2")
  v.fire()
  v.reply(["/h/c1"])
  assert.equal(v.state(), "rows=#contents /h/c1* sel=none")
})

test("a chosen loose row that the section replaces moves to the last name row above it", () => {
  const v = launcher(["/h/s", "/h/l", "/h/c"])
  v.backend.names = [{ path: "/h/s" }, { path: "/h/l", loose: true }]
  v.type("q")
  v.choose("/h/l")
  v.fire()
  v.reply(["/h/c"])
  assert.equal(v.state(), "rows=#files /h/s #contents /h/c* sel=/h/s")
})
