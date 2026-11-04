// The file list behind Phase 7 file search (SPEC §8.6). A listed file is
// { path, name, dir }. A large untouched subtree is { path, count }: a
// directory over the threshold with no usage signal anywhere inside it.

var DEFAULT_THRESHOLD = 5000
var ASK_AGAIN_MS = 7 * 86400000
var RECOUNT_MS = 86400000
var REFRESH_AFTER_MS = 30000

var DEFAULT_IGNORES = [
  "node_modules/", ".cache/", "target/", ".git/", "Cache/", "Code Cache/", "Service Worker/", "compile-cache/"
]

var PRIVATE_PATHS = [
  ".ssh/", ".gnupg/", ".password-store/", ".local/share/keyrings/",
  ".mozilla/", ".zen/", ".config/chromium/", ".config/google-chrome/", ".config/BraveSoftware/", ".config/zen/",
  ".env", ".env.*"
]

function defaultIgnoreText() {
  return [
    "# omacast file search skips these. Gitignore syntax; a pattern with a slash",
    "# in it is relative to your home directory.",
    ""
  ].concat(DEFAULT_IGNORES, ["", "# Private paths"], PRIVATE_PATHS).join("\n") + "\n"
}

function parseList(text) {
  var lines = String(text || "").split("\n")
  var rows = []
  for (var i = 0; i < lines.length; i++) {
    var path = lines[i]
    if (!path) continue
    var slash = path.lastIndexOf("/")
    rows.push({ path: path, name: path.slice(slash + 1), dir: path.slice(0, slash) })
  }
  return rows
}

// zoxide prints "score path"; the git probe prints "<repo>/.git/logs/HEAD".
function parseSignals(text) {
  var lines = String(text || "").split("\n")
  var dirs = []
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    var zoxide = /^[0-9.]+\s+(\/.*)$/.exec(line)
    if (zoxide) dirs.push(zoxide[1])
    else if (/\/\.git\/logs\/HEAD$/.test(line)) dirs.push(line.slice(0, -"/.git/logs/HEAD".length))
  }
  return dirs
}

// Counts files per directory first and only then adds each directory's count
// to its ancestors, so the ancestor walk runs once per directory (48k on the
// dev home), not once per file (327k). The root itself is never flagged: a
// home with no signals yet would otherwise drop every file.
function largeSubtrees(paths, signals, threshold, root) {
  var direct = Object.create(null)
  for (var i = 0; i < paths.length; i++) {
    var dir = paths[i].slice(0, paths[i].lastIndexOf("/"))
    direct[dir] = (direct[dir] || 0) + 1
  }
  var counts = Object.create(null)
  var children = Object.create(null)
  var prefix = root + "/"
  for (var start in direct) {
    var n = direct[start]
    var d = start
    while (d.length > prefix.length && d.indexOf(prefix) === 0) {
      var parent = d.slice(0, d.lastIndexOf("/"))
      if (counts[d] === undefined) {
        counts[d] = 0
        if (children[parent] === undefined) children[parent] = []
        children[parent].push(d)
      }
      counts[d] += n
      d = parent
    }
  }
  function touched(d) {
    for (var s = 0; s < signals.length; s++) if (signals[s] === d || signals[s].indexOf(d + "/") === 0) return true
    return false
  }
  var found = []
  function walk(d) {
    var list = (children[d] || []).slice().sort()
    for (var c = 0; c < list.length; c++) {
      if (counts[list[c]] <= threshold) continue
      if (touched(list[c])) walk(list[c])
      else found.push({ path: list[c], count: counts[list[c]] })
    }
  }
  walk(root)
  return found.sort(function(a, b) { return b.count - a.count || (a.path < b.path ? -1 : 1) })
}

function globSource(glob) {
  return glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]").replace(/\u0000/g, ".*")
}

// Whether a gitignore line in the ignore file already covers the directory.
// Plain names, anchored paths and * globs; negations are not honoured.
function ignores(ignoreText, root, dir) {
  var rel = dir.slice(root.length + 1)
  var lines = String(ignoreText || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\s+$/, "")
    if (!line || line.charAt(0) === "#" || line.charAt(0) === "!") continue
    var pattern = line.replace(/\/+$/, "")
    if (pattern.indexOf("/") >= 0) {
      if (new RegExp("^" + globSource(pattern.replace(/^\//, "")) + "(/|$)").test(rel)) return true
    } else {
      var segment = new RegExp("^" + globSource(pattern) + "$")
      if (rel.split("/").some(function(s) { return segment.test(s) })) return true
    }
  }
  return false
}

function ignoreLine(root, dir) {
  return "/" + dir.slice(root.length + 1).replace(/[\\*?[]/g, "\\$&").replace(/ $/, "\\ ") + "/"
}

function ignoreFileText(subtrees, root) {
  return subtrees.map(function(t) { return ignoreLine(root, t.path) }).join("\n") + (subtrees.length ? "\n" : "")
}

function displayPath(path, home) {
  return path === home || path.indexOf(home + "/") === 0 ? "~" + path.slice(home.length) : path
}

function groupDigits(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function treeToAsk(subtrees, askedAt, ignoreText, root, nowMs) {
  for (var i = 0; i < subtrees.length; i++) {
    var t = subtrees[i]
    var asked = askedAt && askedAt[t.path]
    if (ignores(ignoreText, root, t.path)) continue
    if (asked && nowMs - asked < ASK_AGAIN_MS) continue
    return t
  }
  return null
}

function toastFor(tree, home, ignoreMethod) {
  var shown = displayPath(tree.path, home)
  return {
    style: "success",
    title: "Skipping " + shown + " (" + groupDigits(tree.count) + " files, untouched). Add to ignore file?",
    actions: [{
      id: "add-to-ignore-file", title: "Add to Ignore File", done: "Added " + shown + " to the ignore file",
      call: { method: ignoreMethod, data: { path: tree.path } }
    }]
  }
}

// Strings over 2^24 characters arrive undefined through
// WorkerScript.sendMessage, so a full listing travels as newline-aligned chunks.
function chunks(text, size) {
  var out = []
  var start = 0
  while (start < text.length) {
    var end = start + size >= text.length ? text.length : text.lastIndexOf("\n", start + size) + 1
    if (end <= start) end = text.indexOf("\n", start) + 1 || text.length
    out.push(text.slice(start, end))
    start = end
  }
  return out
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_THRESHOLD: DEFAULT_THRESHOLD, ASK_AGAIN_MS: ASK_AGAIN_MS, RECOUNT_MS: RECOUNT_MS, REFRESH_AFTER_MS: REFRESH_AFTER_MS,
    DEFAULT_IGNORES: DEFAULT_IGNORES, PRIVATE_PATHS: PRIVATE_PATHS, defaultIgnoreText: defaultIgnoreText,
    parseList: parseList, parseSignals: parseSignals, largeSubtrees: largeSubtrees, ignores: ignores,
    ignoreLine: ignoreLine, ignoreFileText: ignoreFileText, displayPath: displayPath, groupDigits: groupDigits,
    treeToAsk: treeToAsk, toastFor: toastFor, chunks: chunks
  }
}

if (typeof WorkerScript !== "undefined" && typeof WorkerScript.sendMessage === "function") {
  WorkerScript.onMessage = function(message) {
    var paths = []
    for (var i = 0; i < message.chunks.length; i++) paths = paths.concat(message.chunks[i].split("\n"))
    WorkerScript.sendMessage({ id: message.id, files: paths.length, subtrees: largeSubtrees(paths, message.signals, message.threshold, message.root) })
  }
}
