// Ranks listed files for Search Files (SPEC §8.6). A listed row is
// { path, name, dir }; a ranked row adds { band, score }. Bands: 0 exact name
// or stem, 1 prefix, 2 word start, 3 substring, 4 subsequence, 5 typo (the
// helper's, absent here), 6 path only. Matching never loops over characters:
// Qt's JS engine runs such a loop 25 times slower than node.

var OPEN_SCALE = 100
var LIFT_FRECENCY = 50
var RECENCY_HALF_LIFE_DAYS = 30
var ACTIVE_PROJECT_WEIGHT = 2
var BANDS = 7

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// "spec" becomes s[^p]*p[^e]*e[^c]*c, which finds the earliest match without
// backtracking. The scan form also stops at a newline, the end of a name.
function subsequenceSource(word, stop) {
  var chars = word.split("")
  return chars.map(function(c, i) {
    var next = chars[i + 1]
    return escapeRegExp(c) + (next === undefined ? "" : "[^" + escapeRegExp(next) + stop + "]*")
  }).join("")
}

function compile(query) {
  return String(query || "").toLowerCase().split(/\s+/).filter(Boolean).map(function(word) {
    var e = escapeRegExp(word)
    return {
      word: word,
      prefix: new RegExp("^" + e, "i"),
      wordStart: new RegExp("(?:^|[-_. ])" + e, "i"),
      substring: new RegExp(e, "i"),
      subsequence: new RegExp(subsequenceSource(word, ""), "i"),
      prefixLines: new RegExp("^" + e + "[^\\n]*", "gim"),
      wordStartLines: new RegExp("[-_. ]" + e + "[^\\n]*", "gi"),
      startLines: new RegExp("(?:^|[-_. ])" + e + "[^\\n]*", "gim"),
      substringLines: new RegExp(e + "[^\\n]*", "gi"),
      lines: new RegExp(subsequenceSource(word, "\\n") + "[^\\n]*", "gi"),
      without: word.length === 1 ? new RegExp("^[^" + e + "\\n]+$", "gim") : null,
      segment: new RegExp("(?:^|/)(?:[^/]*[-_. ])?" + e, "i"),
      segmentLines: new RegExp("(?:^|/)(?:[^/\\n]*[-_. ])?" + e + "[^\\n]*", "gim")
    }
  })
}

function exact(m, name) {
  if (name.length === m.word.length) return name.toLowerCase() === m.word
  var dot = name.lastIndexOf(".")
  return dot === m.word.length && name.slice(0, dot).toLowerCase() === m.word
}

// The subsequence test comes first: it is the loosest band, so a name that
// fails it costs one RegExp.
function nameBand(m, name) {
  if (!m.subsequence.test(name)) return -1
  if (exact(m, name)) return 0
  if (m.prefix.test(name)) return 1
  if (m.wordStart.test(name)) return 2
  if (m.substring.test(name)) return 3
  return 4
}

function relativeDir(dir, home) {
  if (dir === home) return ""
  return dir.indexOf(home + "/") === 0 ? dir.slice(home.length + 1) : dir
}

function band(query, row, home) {
  var words = typeof query === "string" ? compile(query) : query
  if (words.length === 0) return -1
  if (words.length === 1) return nameBand(words[0], row.name)
  var last = nameBand(words[words.length - 1], row.name)
  if (last < 0) return -1
  if (words.every(function(m) { return m.wordStart.test(row.name) })) return 2
  if (last > 2) return -1
  var rel = relativeDir(row.dir, home || "")
  for (var i = 0; i < words.length - 1; i++) if (!words[i].segment.test(rel)) return -1
  return 6
}

// The folder prior: each directory's weight is ln(1 + its zoxide score),
// plus 2 for an active git repo, plus ln(1 + opens / 100) for every omacast
// open below it. zoxide scores reach the hundreds, and taken raw a 40-point
// folder outranked a fifty-times-opened file. probeText is FileLister's signal probe output: zoxide's "score path"
// lines and "<repo>/.git/logs/HEAD" lines. opens maps absolute paths to
// their frecency score, which bottoms out at 1 once every open has decayed,
// so 1 counts as no usage, as it does in root search.
function signals(probeText, opens, home, nowMs) {
  var dirWeight = Object.create(null)
  function add(dir, weight) { dirWeight[dir] = (dirWeight[dir] || 0) + weight }
  String(probeText || "").split("\n").forEach(function(raw) {
    var line = raw.trim()
    var zoxide = /^([0-9.]+)\s+(\/.*)$/.exec(line)
    if (zoxide) add(zoxide[2], Math.log(1 + (Number(zoxide[1]) || 0)))
    else if (/\/\.git\/logs\/HEAD$/.test(line)) add(line.slice(0, -"/.git/logs/HEAD".length), ACTIVE_PROJECT_WEIGHT)
  })
  var opened = Object.create(null)
  Object.keys(opens || {}).forEach(function(path) {
    if (!(opens[path] > 1)) return
    opened[path] = opens[path]
    var weight = Math.log(1 + opened[path] / OPEN_SCALE)
    for (var d = path.slice(0, path.lastIndexOf("/")); d.length > home.length; d = d.slice(0, d.lastIndexOf("/"))) add(d, weight)
  })
  return { home: home, nowMs: nowMs, opens: opened, dirWeight: dirWeight, priorCache: Object.create(null) }
}

function prior(dir, s) {
  if (dir in s.priorCache) return s.priorCache[dir]
  var value = 0
  for (var d = dir, distance = 0; d && d.length >= s.home.length; d = d.slice(0, d.lastIndexOf("/")), distance++) {
    if (s.dirWeight[d]) { value = s.dirWeight[d] / (1 + 0.5 * distance); break }
  }
  s.priorCache[dir] = value
  return value
}

// rg --files prints no mtime, so listed rows carry none and score 0 here.
function recency(row, s) {
  if (!row.mtime) return 0
  return Math.pow(0.5, (s.nowMs / 1000 - row.mtime) / 86400 / RECENCY_HALF_LIFE_DAYS)
}

function usage(row, s) {
  var opens = s.opens[row.path] || 0
  return { opens: opens, recency: recency(row, s), prior: prior(row.dir, s) }
}

function score(row, s) {
  var opens = s.opens[row.path]
  return (opens ? Math.log(1 + opens / OPEN_SCALE) : 0) + 0.5 * recency(row, s) + 0.5 * prior(row.dir, s)
}

var joined = { rows: null, text: "", starts: [], byPath: null, sample: "", sampled: 0, dirs: null, dirList: [], folders: null }

// Every name on its own line, built once per list. A native scan of this
// text finds matching names several times faster in Qt's engine than one
// RegExp call per name.
function joinedNames(rows) {
  if (joined.rows === rows) return joined
  var starts = []
  var byPath = Object.create(null)
  var dirs = Object.create(null)
  var dirList = []
  var at = 0
  for (var r = 0; r < rows.length; r++) {
    starts.push(at)
    byPath[rows[r].path] = r
    at += rows[r].name.length + 1
    if (!dirs[rows[r].dir]) {
      dirs[rows[r].dir] = []
      dirList.push(rows[r].dir)
    }
    dirs[rows[r].dir].push(r)
  }
  var sample = rows.filter(function(row, i) { return i % 16 === 0 })
  joined = {
    rows: rows, text: rows.map(function(row) { return row.name }).join("\n"), starts: starts, byPath: byPath,
    sample: sample.map(function(row) { return row.name }).join("\n"), sampled: sample.length, dirs: dirs, dirList: dirList
  }
  return joined
}

// Every scan regex ends in [^\n]*, so a name matches once. test() allocates
// no match array; exec() made thousands per one-letter keystroke and pulled
// 20 to 100 ms collections of the whole shell's heap into the search.
function scanRows(listed, regex, visit) {
  regex.lastIndex = 0
  var r = 0
  var last = listed.starts.length - 1
  while (regex.test(listed.text)) {
    while (r < last && listed.starts[r + 1] <= regex.lastIndex) r++
    visit(r)
  }
}

// Two replaces counted faster, but each built a string the size of the list
// and 420 live calls saw twice as many collection pauses.
function countIn(text, regex) {
  var n = 0
  regex.lastIndex = 0
  while (regex.test(text)) n++
  return n
}

// Most names hold a common letter, so when a sample of every 16th name says
// so, the names without it are fewer to count.
function countRows(listed, m) {
  if (m.without && 2 * countIn(listed.sample, m.lines) > listed.sampled) return listed.starts.length - countIn(listed.text, m.without)
  return countIn(listed.text, m.lines)
}

// A band's hits as parallel arrays of numbers. Objects for thousands of hits
// per keystroke made the search the likeliest place for the shell's
// collector to run.
function bucket() {
  return { at: [], band: [], score: [] }
}

function add(b, r, matchBand, value) {
  b.at.push(r)
  b.band.push(matchBand)
  b.score.push(value)
}

function byScore(a, b) {
  return b.score - a.score || a.name.length - b.name.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

// Cuts a band at the room-th best score first, so objects are built and
// sorted only for rows that can show.
function take(out, rows, b, max) {
  var room = max - out.length
  if (room <= 0 || !b.at.length) return
  var cut = b.at.length > room ? cutFor(b.score, room) : -Infinity
  var shown = []
  for (var i = 0; i < b.at.length; i++) {
    if (b.score[i] < cut) continue
    var row = rows[b.at[i]]
    shown.push({ path: row.path, name: row.name, dir: row.dir, band: b.band[i], score: b.score[i] })
  }
  shown.sort(byScore)
  for (var j = 0; j < shown.length && out.length < max; j++) out.push(shown[j])
}

// A file opened from omacast within its half-life moves up one band, but
// never into exact or prefix: band 2 stays, 3 to 6 move up one. One open
// scores 101 and halves every 10 days, so 50 keeps it lifted for 10 days.
function liftedBand(matchBand, opens) {
  return matchBand >= 3 && opens >= LIFT_FRECENCY ? matchBand - 1 : matchBand
}

// A scan per band, best first, so a one-letter query with thousands of hits
// scores only the bands it shows.
function rankWord(rows, listed, m, s, max) {
  var seen = new Uint8Array(rows.length)
  var buckets = [bucket(), bucket(), bucket(), bucket(), bucket()]
  Object.keys(s.opens).forEach(function(path) {
    var r = listed.byPath[path]
    if (r === undefined) return
    var matchBand = nameBand(m, rows[r].name)
    var effective = liftedBand(matchBand, s.opens[path])
    if (effective === matchBand) return
    seen[r] = 1
    add(buckets[effective], r, matchBand, score(rows[r], s))
  })
  // The prefix scan fills bands 0 and 1; scan i > 0 fills band i + 1, which
  // is then complete because its lifted rows are already in.
  var scans = [
    { regex: m.prefixLines, band: function(row) { return exact(m, row.name) ? 0 : 1 } },
    { regex: m.wordStartLines, band: function() { return 2 } },
    { regex: m.substringLines, band: function() { return 3 } },
    { regex: m.lines, band: function() { return 4 } }
  ]
  var out = []
  scans.forEach(function(scan, i) {
    if (out.length >= max) return
    scanRows(listed, scan.regex, function(r) {
      if (seen[r]) return
      seen[r] = 1
      var matchBand = scan.band(rows[r])
      add(buckets[matchBand], r, matchBand, score(rows[r], s))
    })
    for (var b = i === 0 ? 0 : i + 1; b <= i + 1; b++) take(out, rows, buckets[b], max)
  })
  return { hits: countRows(listed, m), rows: out }
}

// The folders relative to home, one per line, built once per list like the
// names.
function joinedFolders(listed, home) {
  if (listed.folders && listed.folders.home === home) return listed.folders
  var starts = []
  var at = 0
  var rel = listed.dirList.map(function(dir) {
    var line = relativeDir(dir, home)
    starts.push(at)
    at += line.length + 1
    return line
  })
  listed.folders = { home: home, text: rel.join("\n"), starts: starts, rel: rel }
  return listed.folders
}

function wordStartsAll(words, name) {
  for (var i = 0; i < words.length; i++) if (!words[i].wordStart.test(name)) return false
  return true
}

// Band 2 needs every word to start a word in the name, so the longest word's
// scan finds its candidates. Band 6 needs the other words in the folder, so
// the folders are filtered first: scanning for a one-letter last word made
// band() run on 14,000 names (25 to 33 ms for "oma s").
function rankWords(rows, listed, words, s, max) {
  var buckets = [bucket(), bucket(), bucket(), bucket(), bucket(), bucket(), bucket()]
  var seen = new Uint8Array(rows.length)
  var count = 0
  var longest = words.reduce(function(a, b) { return b.word.length > a.word.length ? b : a })
  scanRows(listed, longest.startLines, function(r) {
    if (!wordStartsAll(words, rows[r].name)) return
    seen[r] = 1
    count++
    add(buckets[2], r, 2, score(rows[r], s))
  })
  var last = words[words.length - 1]
  var others = words.slice(1, -1)
  var folders = joinedFolders(listed, s.home)
  // A word start in the name covers exact and prefix too. Rows that cannot
  // show because band 2 already fills the limit are only counted.
  var shown = buckets[2].at.length < max
  scanRows(folders, words[0].segmentLines, function(d) {
    for (var i = 0; i < others.length; i++) if (!others[i].segment.test(folders.rel[d])) return
    var inDir = listed.dirs[listed.dirList[d]]
    for (var j = 0; j < inDir.length; j++) {
      var r = inDir[j]
      if (seen[r] || !last.wordStart.test(rows[r].name)) continue
      count++
      if (shown) add(buckets[liftedBand(6, s.opens[rows[r].path] || 0)], r, 6, score(rows[r], s))
    }
  })
  var out = []
  buckets.forEach(function(b) { take(out, rows, b, max) })
  return { hits: count, rows: out }
}

// Builds the joined names and folders, every listed folder's prior and the
// empty query's rows, so the first keystroke after a new list or new signals pays
// for none of them (20 to 40 ms on the dev machine's 19,900 files).
function prepare(rows, s, limit) {
  joinedFolders(joinedNames(rows), s.home)
  recent(rows, s, limit)
}

function rank(rows, query, s, limit) {
  var words = compile(query)
  var max = limit > 0 ? limit : Infinity
  if (words.length === 0) return recent(rows, s, limit)
  var listed = joinedNames(rows)
  return words.length === 1 ? rankWord(rows, listed, words[0], s, max) : rankWords(rows, listed, words, s, max)
}

// The k-th largest value, or 0 when there are fewer than k. A heap, because
// Qt's typed arrays have no sort.
function cutFor(values, k) {
  var heap = []
  for (var i = 0; i < values.length; i++) {
    var v = values[i]
    if (heap.length === k && v <= heap[0]) continue
    var at = heap.length < k ? heap.push(v) - 1 : 0
    heap[at] = v
    for (;;) {
      var parent = (at - 1) >> 1
      var child = 2 * at + 1
      if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++
      if (at > 0 && heap[at] < heap[parent]) { var up = heap[at]; heap[at] = heap[parent]; heap[parent] = up; at = parent }
      else if (child < heap.length && heap[child] < heap[at]) { var down = heap[at]; heap[at] = heap[child]; heap[child] = down; at = child }
      else break
    }
  }
  return heap.length === k ? heap[0] : 0
}

// The empty query ranks by usage alone, files opened from omacast first: a
// folder's zoxide score has no ceiling, so in one blend the untouched files
// of a busy folder outranked a file opened twice. Its rows depend only on
// the list and the signals, so they are kept on the signals object.
function recent(rows, s, limit) {
  var max = limit > 0 ? limit : Infinity
  var cached = s.recent
  if (cached && cached.rows === rows && cached.max === max) return cached.result
  var values = new Float64Array(rows.length)
  var opened = bucket()
  var hits = 0
  var dir = null
  var dirPrior = 0
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r]
    if (row.dir !== dir) {
      dir = row.dir
      dirPrior = prior(dir, s)
    }
    var opens = s.opens[row.path]
    var value = (opens ? Math.log(1 + opens / OPEN_SCALE) : 0) + 0.5 * recency(row, s) + 0.5 * dirPrior
    if (opens) add(opened, r, -1, value)
    else values[r] = value
    if (value > 0) hits++
  }
  var cut = hits - opened.at.length > max ? cutFor(values, max) : 0
  var rest = bucket()
  for (var i = 0; i < rows.length; i++) if (values[i] > 0 && values[i] >= cut) add(rest, i, -1, values[i])
  var out = []
  take(out, rows, opened, max)
  take(out, rows, rest, max)
  s.recent = { rows: rows, max: max, result: { hits: hits, rows: out } }
  return s.recent.result
}

if (typeof module !== "undefined") {
  module.exports = {
    band: band, signals: signals, usage: usage, prepare: prepare, rank: rank
  }
}
