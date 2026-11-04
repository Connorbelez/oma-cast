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

// Exit 3 is the list script's missing ignore file and 124 is timeout's. rg
// exits 2 for any error, and exitStatus 1 means a signal ended the run, so
// either may leave a list cut short.
function listOutcome(runs) {
  if (runs.some(function(r) { return r.exitStatus === 0 && r.exitCode === 124 })) return { warnings: ["files: refresh timed out"] }
  if (runs.some(function(r) { return r.exitStatus === 0 && r.exitCode === 3 })) return { missing: true }
  var warnings = []
  var failed = false
  runs.forEach(function(r) {
    if (r.exitStatus === 0 && r.exitCode === 0) return
    if (r.exitStatus === 0 && r.exitCode === 2 && r.text) {
      warnings.push("files: rg exited 2 for " + r.root + "; listed what it could read")
      return
    }
    failed = true
    warnings.push("files: rg exited " + (r.exitStatus !== 0 ? "abnormally" : r.exitCode) + " for " + r.root + "; keeping the previous list")
  })
  if (failed) return { warnings: warnings }
  var out = { rows: parseList(runs.map(function(r) { return r.text }).join("")) }
  if (warnings.length) out.warnings = warnings
  return out
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

// The daily recount, run as one process outside the shell: rg lists the
// whole home dir and awk keeps a file count per directory, printing
// "<count>\t<dir>" for the root and each directory over the threshold. Each
// directory adds its own files to its ancestors once, which beats walking the
// ancestors of every file (48k directories against 327k files on the dev home).
var RECOUNT_SCRIPT = 'set -o pipefail; rg --files "$1" | LC_ALL=C root="$1" awk -F/ -v threshold="$3" "$2"'

var COUNT_PROGRAM = [
  'BEGIN { r = ENVIRON["root"]; k = split(r, part, "/"); prefix = r "/" }',
  '{ n[substr($0, 1, length($0) - length($NF) - 1)]++ }',
  'END {',
  '  print NR "\\t" r',
  '  for (d in n) {',
  '    if (index(d "/", prefix) != 1) continue',
  '    m = split(d, part, "/"); p = r',
  '    for (i = k + 1; i <= m; i++) { p = p "/" part[i]; c[p] += n[d] }',
  '  }',
  '  for (p in c) if (c[p] > threshold) print c[p] "\\t" p',
  '}'
].join("\n")

function parseCounts(text) {
  var lines = String(text || "").split("\n")
  var counts = {}
  for (var i = 0; i < lines.length; i++) {
    var tab = lines[i].indexOf("\t")
    if (tab > 0) counts[lines[i].slice(tab + 1)] = Number(lines[i].slice(0, tab))
  }
  return counts
}

// Under pipefail the recount exits with rg's 2 for one unreadable folder
// while awk still counts the rest, so a total over zero is a usable count.
function recountOutcome(run, root) {
  if (run.exitStatus === 0 && run.exitCode === 124) return { warnings: ["files: recount timed out"] }
  var counts = parseCounts(run.text)
  if (run.exitStatus === 0 && run.exitCode === 0) return { counts: counts }
  if (run.exitStatus === 0 && run.exitCode === 2 && counts[root] > 0) {
    return { counts: counts, warnings: ["files: recount exited 2 for " + root + "; counted what it could read"] }
  }
  return { warnings: ["files: recount exited " + (run.exitStatus !== 0 ? "abnormally" : run.exitCode) + " for " + root + "; keeping the previous large subtrees"] }
}

// The topmost directories over the threshold with no signal inside, walking
// down from the root as docs/phase7-prototypes/detect.py does. The root itself
// is never flagged, or a home with no signals yet would drop every file.
function largeSubtrees(counts, signals, threshold, root) {
  var children = {}
  for (var dir in counts) {
    if (dir.indexOf(root + "/") !== 0) continue
    var parent = dir.slice(0, dir.lastIndexOf("/"))
    if (!children[parent]) children[parent] = []
    children[parent].push(dir)
  }
  function touched(d) {
    return signals.some(function(s) { return s === d || s.indexOf(d + "/") === 0 })
  }
  var found = []
  function walk(d) {
    var list = (children[d] || []).slice().sort()
    for (var i = 0; i < list.length; i++) {
      if (!(counts[list[i]] > threshold)) continue
      if (touched(list[i])) walk(list[i])
      else found.push({ path: list[i], count: counts[list[i]] })
    }
  }
  walk(root)
  return found.sort(function(a, b) { return b.count - a.count || (a.path < b.path ? -1 : 1) })
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")
}

// One gitignore glob as a RegExp source, read the way rg reads it, or null
// where rg rejects the line: a dangling "\" or an unbalanced "{" or "}".
// An unclosed "[" is a literal "[", as it is in rg.
function globSource(glob) {
  var i = 0
  function sequence(inBraces) {
    var out = ""
    while (i < glob.length) {
      var c = glob.charAt(i)
      if (inBraces && (c === "," || c === "}")) return out
      i++
      if (c === "\\") {
        if (i >= glob.length) return null
        out += escapeRegExp(glob.charAt(i++))
      } else if (c === "*" && glob.charAt(i) === "*") {
        i++
        if (glob.charAt(i) === "/") { i++; out += "(?:.*/)?" } else out += ".*"
      } else if (c === "*") {
        out += "[^/]*"
      } else if (c === "?") {
        out += "[^/]"
      } else if (c === "[") {
        var negated = glob.charAt(i) === "!" || glob.charAt(i) === "^"
        var close = glob.indexOf("]", i + (negated ? 2 : 1))
        if (close < 0) { out += "\\["; continue }
        var members = glob.slice(negated ? i + 1 : i, close).replace(/[\\\]\[^]/g, "\\$&")
        out += negated ? "[^/" + members + "]" : "[" + members + "]"
        i = close + 1
      } else if (c === "{") {
        var alternatives = []
        for (;;) {
          var alternative = sequence(true)
          if (alternative === null || i >= glob.length) return null
          alternatives.push(alternative)
          if (glob.charAt(i++) === "}") break
        }
        out += "(?:" + alternatives.join("|") + ")"
      } else if (c === "}") {
        return null
      } else {
        out += escapeRegExp(c)
      }
    }
    return inBraces ? null : out
  }
  return sequence(false)
}

// The ignore file's lines as RegExps over a path relative to the root, and
// the lines rg rejects. A line with a slash before its end is anchored at
// the root; a plain name matches any path segment. Negations are skipped.
function ignorePatterns(ignoreText) {
  var lines = String(ignoreText || "").split("\n")
  var patterns = []
  var bad = []
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/(^|[^\\])\s+$/, "$1")
    if (!line || line.charAt(0) === "#" || line.charAt(0) === "!") continue
    var glob = line.replace(/\/$/, "")
    var anchored = glob.indexOf("/") >= 0
    var source = globSource(anchored ? glob.replace(/^\//, "") : glob)
    var pattern = null
    if (source !== null) {
      try { pattern = new RegExp((anchored ? "^" : "(?:^|/)") + source + "(?:/|$)") } catch (e) {}
    }
    if (pattern) patterns.push(pattern)
    else bad.push(lines[i])
  }
  return { patterns: patterns, bad: bad }
}

function ignores(ignoreText, root, dir) {
  var rel = dir.slice(root.length + 1)
  return ignorePatterns(ignoreText).patterns.some(function(p) { return p.test(rel) })
}

function badIgnoreLines(ignoreText) {
  return ignorePatterns(ignoreText).bad
}

function ignoreLine(root, dir) {
  return "/" + dir.slice(root.length + 1).replace(/[\\*?[\]{}]/g, "\\$&") + "/"
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
    title: "Skipping " + shown + " (" + groupDigits(tree.count) + " files)",
    actions: [{
      id: "add-to-ignore-file", title: "Add to Ignore File", done: "Added " + shown + " to the ignore file",
      call: { method: ignoreMethod, data: { path: tree.path } }
    }]
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_THRESHOLD: DEFAULT_THRESHOLD, ASK_AGAIN_MS: ASK_AGAIN_MS, RECOUNT_MS: RECOUNT_MS, REFRESH_AFTER_MS: REFRESH_AFTER_MS,
    DEFAULT_IGNORES: DEFAULT_IGNORES, PRIVATE_PATHS: PRIVATE_PATHS, defaultIgnoreText: defaultIgnoreText,
    RECOUNT_SCRIPT: RECOUNT_SCRIPT, COUNT_PROGRAM: COUNT_PROGRAM,
    parseList: parseList, listOutcome: listOutcome, parseSignals: parseSignals, parseCounts: parseCounts, recountOutcome: recountOutcome, largeSubtrees: largeSubtrees, ignores: ignores, badIgnoreLines: badIgnoreLines,
    ignoreLine: ignoreLine, ignoreFileText: ignoreFileText, displayPath: displayPath, groupDigits: groupDigits,
    treeToAsk: treeToAsk, toastFor: toastFor
  }
}
