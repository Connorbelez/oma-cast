import QtQuick
import "names.js" as N
QtObject {
  Component.onCompleted: {
    var names = N.NAMES, joined = "\n" + names.join("\n") + "\n"
    function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }
    var qs = ["spec", "launcher", "readme", "frec", "s", "app"]
    for (var r = 0; r < 2; r++) for (var qi = 0; qi < qs.length; qi++) {
      var q = qs[qi]
      // Variant 1: one native regex scan over the joined list for each band
      var t0 = Date.now()
      var subRe = new RegExp("\n[^\n]*" + q.split("").map(esc).join("[^\n]*") + "[^\n]*(?=\n)", "g")
      var conRe = new RegExp("\n[^\n]*" + esc(q) + "[^\n]*(?=\n)", "g")
      var sub = joined.match(subRe) || [], con = joined.match(conRe) || []
      var t1 = Date.now()
      // Variant 2: per-name native regex test
      var re2 = new RegExp(q.split("").map(esc).join(".*")), hits2 = 0
      for (var i = 0; i < names.length; i++) if (re2.test(names[i])) hits2++
      var t2 = Date.now()
      console.error("V4re", q, "joined-scan", sub.length, "subseq", con.length, "contains", (t1 - t0), "ms;", "per-name regex", hits2, "hits", (t2 - t1), "ms")
    }
    Qt.quit()
  }
}
