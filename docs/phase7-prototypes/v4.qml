import QtQuick
import "names.js" as N
QtObject {
  Component.onCompleted: {
    var names = N.NAMES
    function subseq(q, s) { var i = 0; for (var k = 0; k < s.length; k++) if (s[k] === q[i]) i++; return i === q.length }
    function band(q, s) { if (s === q || s.slice(0, s.lastIndexOf(".")) === q) return 0; if (s.indexOf(q) === 0) return 1; if (s.indexOf(q) > 0) return 2; if (subseq(q, s)) return 3; return -1 }
    var qs = ["spec", "launcher", "readme", "frec", "s", "app"]
    for (var r = 0; r < 3; r++) for (var qi = 0; qi < qs.length; qi++) {
      var q = qs[qi], t0 = Date.now(), hits = 0
      for (var i = 0; i < names.length; i++) if (band(q, names[i]) >= 0) hits++
      console.error("V4", q, hits, "hits", (Date.now() - t0), "ms over", names.length, "names")
    }
    Qt.quit()
  }
}
