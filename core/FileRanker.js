// Ranks listed files for Search Files (SPEC §8.6). A listed row is
// { path, name, dir }; a ranked row adds { band, score }. Bands, lower is
// better: 0 exact name or stem, 1 prefix, 2 word start, 3 substring,
// 4 subsequence, 5 typo (the helper's, absent here), 6 path only. Every match
// goes through a RegExp built once per query: Qt's JS engine runs a character
// loop 25 times slower than node (docs/phase7-prototypes/README.md).

var LIFT_OPENS = 100
var RECENCY_HALF_LIFE_DAYS = 30
var ACTIVE_PROJECT_WEIGHT = 2
var BANDS = 7

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// "spec" becomes s[^p]*p[^e]*e[^c]*c, which finds the earliest match without
// backtracking.
function subsequenceSource(word) {
  var chars = word.split("")
  return chars.map(function(c, i) {
    var next = chars[i + 1]
    return escapeRegExp(c) + (next === undefined ? "" : "[^" + escapeRegExp(next) + "]*")
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
      subsequence: new RegExp(subsequenceSource(word), "i"),
      segment: new RegExp("(?:^|/)(?:[^/]*[-_. ])?" + e, "i")
    }
  })
}

function exact(m, name) {
  if (name.length === m.word.length) return name.toLowerCase() === m.word
  var dot = name.lastIndexOf(".")
  return dot === m.word.length && name.slice(0, dot).toLowerCase() === m.word
}

function nameBand(m, name) {
  if (exact(m, name)) return 0
  if (m.prefix.test(name)) return 1
  if (m.wordStart.test(name)) return 2
  if (m.substring.test(name)) return 3
  if (m.subsequence.test(name)) return 4
  return -1
}

function relativeDir(dir, home) {
  return dir.indexOf(home + "/") === 0 ? dir.slice(home.length + 1) : dir
}

// band(query, row, home): the query as a string or as compile(query).
function band(query, row, home) {
  var words = typeof query === "string" ? compile(query) : query
  if (words.length === 0) return -1
  if (words.length === 1) return nameBand(words[0], row.name)
  if (words.every(function(m) { return m.wordStart.test(row.name) })) return 2
  var last = nameBand(words[words.length - 1], row.name)
  if (last < 0 || last > 2) return -1
  var rel = relativeDir(row.dir, home || "")
  for (var i = 0; i < words.length - 1; i++) if (!words[i].segment.test(rel)) return -1
  return 6
}

// The folder prior: each directory's weight is its zoxide score, plus 2 for
// an active git repo, plus ln(1 + opens / 100) for every omacast open below
// it. probeText is FileLister's signal probe output: zoxide's "score path"
// lines and "<repo>/.git/logs/HEAD" lines. opens maps absolute paths to
// their frecency score.
function signals(probeText, opens, home, nowMs) {
  var dirWeight = Object.create(null)
  function add(dir, weight) { dirWeight[dir] = (dirWeight[dir] || 0) + weight }
  String(probeText || "").split("\n").forEach(function(raw) {
    var line = raw.trim()
    var zoxide = /^([0-9.]+)\s+(\/.*)$/.exec(line)
    if (zoxide) add(zoxide[2], Number(zoxide[1]) || 0)
    else if (/\/\.git\/logs\/HEAD$/.test(line)) add(line.slice(0, -"/.git/logs/HEAD".length), ACTIVE_PROJECT_WEIGHT)
  })
  var opened = opens || {}
  Object.keys(opened).forEach(function(path) {
    var weight = Math.log(1 + opened[path] / LIFT_OPENS)
    for (var d = path.slice(0, path.lastIndexOf("/")); d.length > home.length; d = d.slice(0, d.lastIndexOf("/"))) add(d, weight)
  })
  return { home: home, nowMs: nowMs, opens: opened, dirWeight: dirWeight, priorCache: Object.create(null) }
}

// The nearest weighted ancestor's weight over 1 + 0.5 × distance, cached
// per directory for the life of one signals object.
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
  var u = usage(row, s)
  return Math.log(1 + u.opens / LIFT_OPENS) + 0.5 * u.recency + 0.5 * u.prior
}

function byScore(a, b) {
  return b.score - a.score || a.name.length - b.name.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

function ranked(row, matchBand, s) {
  return { path: row.path, name: row.name, dir: row.dir, band: matchBand, score: score(row, s) }
}

// A file opened from omacast within its half-life moves up one band, but
// never into exact or prefix: band 2 stays, 3 to 6 move up one.
function rank(rows, query, s, limit) {
  var words = compile(query)
  var max = limit > 0 ? limit : Infinity
  if (words.length === 0) return recent(rows, s, limit)
  var buckets = []
  for (var b = 0; b < BANDS; b++) buckets.push([])
  var hits = 0
  rows.forEach(function(row) {
    var matchBand = band(words, row, s.home)
    if (matchBand < 0) return
    hits++
    var lifted = matchBand >= 3 && (s.opens[row.path] || 0) >= LIFT_OPENS
    buckets[lifted ? matchBand - 1 : matchBand].push({ row: row, band: matchBand })
  })
  var out = []
  for (var i = 0; i < BANDS && out.length < max; i++) {
    var scored = buckets[i].map(function(hit) { return ranked(hit.row, hit.band, s) }).sort(byScore)
    out = out.concat(scored.slice(0, max - out.length))
  }
  return { hits: hits, rows: out }
}

// The empty query: every row with any usage, by usage alone. Keeps only the
// best `limit` rows instead of sorting the whole list.
function recent(rows, s, limit) {
  var max = limit > 0 ? limit : Infinity
  var best = []
  var hits = 0
  rows.forEach(function(row) {
    var value = score(row, s)
    if (!(value > 0)) return
    hits++
    if (best.length >= max && value <= best[best.length - 1].score) return
    best.push({ path: row.path, name: row.name, dir: row.dir, band: -1, score: value })
    best.sort(byScore)
    if (best.length > max) best.pop()
  })
  return { hits: hits, rows: best }
}

if (typeof module !== "undefined") {
  module.exports = {
    LIFT_OPENS: LIFT_OPENS, compile: compile, band: band, signals: signals, usage: usage, rank: rank, recent: recent
  }
}
