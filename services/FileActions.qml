import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons

Item {
  id: actions

  signal trashed(string path, bool ok)
  signal message(string level, string text, var metadata)

  readonly property int textLimit: 1048576
  readonly property int imageLimit: 20971520
  readonly property int lineLimit: 200

  readonly property var list: [
    { id: "open", title: "Open", shortcut: "↵", section: "primary", icon: "" },
    { id: "show-in-folder", title: "Show in Folder", shortcut: "Ctrl ↵", section: "primary", icon: "" },
    { id: "open-with", title: "Open With…", shortcut: "Ctrl Shift ↵", section: "primary", icon: "" },
    { id: "quick-look", title: "Quick Look", shortcut: "Ctrl Y", section: "primary", icon: "" },
    { id: "copy-path", title: "Copy Path", shortcut: "Ctrl Shift C", section: "copy", icon: "" },
    { id: "trash", title: "Move to Trash", shortcut: "Ctrl D", section: "delete", icon: "" }
  ]

  function listedPath(value, rows) {
    var path = String(value || "")
    if (path.charAt(0) !== "/" || /[\n\r\0]/.test(path)) throw new Error("Expected an absolute path, got " + JSON.stringify(path))
    if (!rows.some(function(r) { return r.path === path })) throw new Error("not in the file list")
    return path
  }

  function trashPath(value, rows, home) {
    var path = actions.listedPath(value, rows)
    if (path.indexOf(home + "/") !== 0) throw new Error("Only files under " + home + " go to the Trash")
    return path
  }

  function previewMode(name) {
    var dot = name.lastIndexOf(".")
    var ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
    if (/^(png|jpe?g|gif|webp|bmp|ico|tiff?|tga)$/.test(ext)) return "image"
    if (ext === "svg") return "svg"
    if (ext === "pdf") return "pdf"
    if (/^(zip|gz|tgz|xz|zst|bz2|7z|rar|tar|iso|img|qcow2|mp4|mkv|webm|mov|avi|mp3|flac|ogg|opus|wav|m4a|so|o|a|exe|dll|bin|class|jar|pyc|wasm|woff2?|ttf|otf|sqlite3?|db|deb|rpm|apk|psd|blend|uasset|umap|pak)$/.test(ext)) return "meta"
    return "text"
  }

  function limitFor(mode) {
    return mode === "image" || mode === "svg" ? actions.imageLimit : actions.textLimit
  }

  readonly property string previewScript: 'meta=$(stat -Lc "%s %Y" -- "$1" 2>/dev/null || stat -c "%s %Y" -- "$1") || exit 3; [[ -f $1 ]] || { printf "%s\\n\\n" "$meta"; exit 4; }; size=${meta%% *}; info=; case $2 in image) info=$(file -Lb -- "$1") ;; pdf) command -v pdftotext >/dev/null && info=pdftotext || info=none ;; esac; printf "%s\\n%s\\n" "$meta" "$info"; (( size <= $3 )) || exit 0; case $2 in text) exec head -c 65536 -- "$1" ;; svg) exec head -c 4096 -- "$1" ;; pdf) [[ $info = pdftotext ]] && pdftotext -l 1 -q -- "$1" - | head -c 65536 ;; esac; exit 0'

  function parsePreview(path, mode, output, limit, code) {
    var slash = path.lastIndexOf("/")
    var base = { kind: "meta", path: path, name: path.slice(slash + 1), dir: path.slice(0, slash) || "/" }
    var first = output.indexOf("\n")
    var second = output.indexOf("\n", first + 1)
    if (first < 0 || second < 0) return base
    var meta = output.slice(0, first).split(" ")
    var info = output.slice(first + 1, second)
    var body = output.slice(second + 1)
    base.size = Number(meta[0])
    base.mtime = Number(meta[1])
    if (code !== 0 || base.size > limit) return base
    if (mode === "image" || mode === "svg") {
      var dims = mode === "image" ? actions.imageSize(info) : actions.svgSize(body)
      base.kind = "image"
      base.imageSource = "file://" + path.split("/").map(encodeURIComponent).join("/")
      if (dims) { base.width = dims.width; base.height = dims.height }
      return base
    }
    if (mode === "pdf" && info !== "pdftotext") return base
    if (mode !== "text" && mode !== "pdf") return base
    if (/\u0000/.test(body) || (body.match(/\ufffd/g) || []).length > body.length / 20 + 1) return base
    var lines = (mode === "pdf" ? body.replace(/\f/g, "").replace(/\s+$/, "") : body.replace(/\ufffd$/, "").replace(/\n$/, "")).split("\n")
    base.kind = mode
    base.lines = Math.min(lines.length, actions.lineLimit)
    base.truncated = lines.length > actions.lineLimit || (mode === "text" && base.size > 65536)
    base.text = lines.slice(0, actions.lineLimit).join("\n")
    return base
  }

  // `file -Lb` prints a JFIF density and a BMP resolution in the same WxH
  // form as the pixel size, and TIFF only as width= and height=.
  function imageSize(info) {
    var size = null
    info.replace(/(density |resolution )?(\d+) ?x ?(\d+)/g, function(all, label, w, h) {
      if (!label) size = { width: Number(w), height: Number(h) }
      return all
    })
    if (size) return size
    var w = info.match(/\bwidth=(\d+)/)
    var h = info.match(/\bheight=(\d+)/)
    return w && h ? { width: Number(w[1]), height: Number(h[1]) } : null
  }

  function svgSize(head) {
    var tag = (head.match(/<svg\b[^>]*>/) || [""])[0]
    var w = tag.match(/\swidth="([\d.]+)(px)?"/)
    var h = tag.match(/\sheight="([\d.]+)(px)?"/)
    if (w && h) return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) }
    var box = tag.match(/viewBox="[\d.\s-]*?([\d.]+)[\s,]+([\d.]+)"/)
    return box ? { width: Math.round(Number(box[1])), height: Math.round(Number(box[2])) } : null
  }

  property var queued: null

  function preview(path, done) {
    var slash = path.lastIndexOf("/")
    var mode = actions.previewMode(path.slice(slash + 1))
    var request = { path: path, mode: mode, limit: actions.limitFor(mode), done: done }
    if (previewRun.running && previewRun.path === path && previewRun.done && !actions.queued) {
      var first = previewRun.done
      previewRun.done = function(preview) { first(preview); done(preview) }
      return
    }
    if (previewRun.running) {
      actions.queued = request
      previewRun.done = null
      previewRun.signal(15)
      return
    }
    actions.startPreview(request)
  }

  function cancelPreview() {
    actions.queued = null
    previewRun.done = null
    if (previewRun.running) previewRun.signal(15)
  }

  function startPreview(request) {
    previewRun.path = request.path
    previewRun.mode = request.mode
    previewRun.limit = String(request.limit)
    previewRun.done = request.done
    previewRun.exited = false
    previewRun.streamed = false
    previewRun.running = true
  }

  function previewDone() {
    if (!previewRun.exited || !previewRun.streamed) return
    var done = previewRun.done
    previewRun.done = null
    var next = actions.queued
    actions.queued = null
    if (previewRun.code === 124) actions.message("warning", "files: preview timed out", null)
    if (done) done(actions.parsePreview(previewRun.path, previewRun.mode, previewOut.text, Number(previewRun.limit), previewRun.code))
    if (next) actions.startPreview(next)
  }

  // timeout puts the script in its own process group, and SIGTERM to it
  // ends the group, so a cancel leaves no pdftotext or head behind.
  Process {
    id: previewRun
    property string path: ""
    property string mode: ""
    property string limit: ""
    property var done: null
    property bool exited: false
    property bool streamed: false
    property int code: -1
    command: ["timeout", "-k", "2", "10", "bash", "-c", actions.previewScript, "omacast-preview", previewRun.path, previewRun.mode, previewRun.limit]
    stdout: StdioCollector {
      id: previewOut
      onStreamFinished: { previewRun.streamed = true; actions.previewDone() }
    }
    onExited: function(exitCode, exitStatus) {
      previewRun.code = exitStatus === 0 ? exitCode : -1
      previewRun.exited = true
      actions.previewDone()
    }
  }

  function showInFolder(path) {
    var dir = path.slice(0, path.lastIndexOf("/")) || "/"
    Util.execArgv(["uwsm-app", "--", "xdg-open", dir])
  }

  function openWith(path, desktopId) {
    Util.execArgv(["uwsm-app", "--", "gtk-launch", desktopId, path])
  }

  property var trashQueue: []

  function trash(path) {
    actions.trashQueue = actions.trashQueue.concat([path])
    if (!trashRun.running) actions.nextTrash()
  }

  function nextTrash() {
    if (!actions.trashQueue.length) return
    trashRun.path = actions.trashQueue[0]
    actions.trashQueue = actions.trashQueue.slice(1)
    trashRun.running = true
  }

  Process {
    id: trashRun
    property string path: ""
    command: ["gio", "trash", "--", trashRun.path]
    onExited: function(exitCode) {
      actions.trashed(trashRun.path, exitCode === 0)
      actions.nextTrash()
    }
  }
}
