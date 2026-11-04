import QtQuick
import Quickshell.Io
import "../core/FileIndex.js" as FileIndex

// Holds the file list for file search (SPEC §8.6). Every rg run is a fixed
// argv of flags, roots and omacast's own ignore files, run from the home dir
// because rg anchors --ignore-file patterns at the working directory.
Item {
  id: lister

  required property string home
  required property string configRoot
  required property string ignoreFile
  required property string untouchedFile
  required property string stateFile
  property bool ready: false

  readonly property var defaultRoots: [lister.home, lister.configRoot]
  property var rows: []
  property var roots: []
  property double listedAt: 0
  property int listMs: 0
  property bool refreshing: false
  property double refreshStartedAt: 0

  property var subtrees: []
  property double recountedAt: 0
  property int recountFiles: 0
  property bool recounting: false
  property bool recountDue: false
  property double recountStartedAt: 0

  property var signals: []
  property double signalsAt: 0

  property string ignoreText: ""
  property bool ignoreFileReady: false
  property bool stateLoaded: false
  property bool started: false
  property var writes: []

  signal message(string level, string text, var metadata)

  readonly property string writeScript: 'umask 077; case $1 in create) [[ -e $2 ]] && exec cat >/dev/null; exec cat >"$2" ;; append) exec cat >>"$2" ;; replace) cat >"$2.tmp" && exec mv -f -- "$2.tmp" "$2" ;; esac; exit 2'
  readonly property string signalsScript: "zoxide query --list --score 2>/dev/null; fd -H -t f -p '/\\.git/logs/HEAD$' --changed-within 14d --max-depth 8 --exclude node_modules . \"$1\" 2>/dev/null; exit 0"

  onReadyChanged: {
    if (!lister.ready) return
    lister.save("create", lister.ignoreFile, FileIndex.defaultIgnoreText(), function() { lister.ignoreFileReady = true })
  }

  function begin() {
    if (lister.started || !lister.ignoreFileReady || !lister.stateLoaded) return
    lister.save("replace", lister.untouchedFile, FileIndex.ignoreFileText(lister.subtrees, lister.home), function() {
      lister.started = true
      if (lister.recountedAt) lister.refresh(lister.defaultRoots)
      if (Date.now() - lister.recountedAt >= FileIndex.RECOUNT_MS) lister.recount()
    })
  }
  onIgnoreFileReadyChanged: lister.begin()
  onStateLoadedChanged: lister.begin()

  // The previous list answers until the refresh lands, so it starts after
  // the launcher's first frames instead of queueing behind them.
  function opened() {
    if (lister.started && Date.now() - lister.listedAt > FileIndex.REFRESH_AFTER_MS) openRefresh.restart()
  }

  Timer {
    id: openRefresh
    interval: 250
    onTriggered: lister.refresh(lister.defaultRoots)
  }

  function hidden() {
    if (lister.started && (lister.recountDue || Date.now() - lister.recountedAt >= FileIndex.RECOUNT_MS)) lister.recount()
  }

  // ------------------------------------------------------------- the list

  function refresh(roots) {
    if (lister.refreshing || !lister.started) return false
    lister.refreshing = true
    lister.refreshStartedAt = Date.now()
    homeRun.root = roots[0]
    configRun.root = roots[1] || ""
    for (var run of [homeRun, configRun]) { run.exitCode = -1; run.streamed = false }
    homeRun.running = true
    if (configRun.root) configRun.running = true
    return true
  }

  function runDone(run) { return run.exitCode >= 0 && run.streamed }

  function listed() {
    if (!lister.refreshing || !lister.runDone(homeRun) || (configRun.root && !lister.runDone(configRun))) return
    lister.refreshing = false
    lister.readSignals()
    var runs = configRun.root ? [homeRun, configRun] : [homeRun]
    var texts = []
    for (var i = 0; i < runs.length; i++) {
      var text = runs[i].stdout.text
      if (runs[i].exitCode >= 2) {
        lister.message("warning", "files: rg exited " + runs[i].exitCode + " for " + runs[i].root + (text ? "; using its partial list" : "; keeping the previous list"), null)
        if (!text) return
      }
      texts.push(text)
    }
    var next = FileIndex.parseList(texts.join(""))
    lister.rows = next
    lister.roots = runs.map(function(run) { return run.root })
    lister.listedAt = Date.now()
    lister.listMs = lister.listedAt - lister.refreshStartedAt
    lister.message("info", "files: listed " + next.length + " paths in " + lister.listMs + " ms", null)
  }

  Process {
    id: homeRun
    property string root: ""
    property int exitCode: -1
    property bool streamed: false
    workingDirectory: lister.home
    command: ["rg", "--files", "--ignore-file", lister.ignoreFile, "--ignore-file", lister.untouchedFile, homeRun.root]
    stdout: StdioCollector { onStreamFinished: { homeRun.streamed = true; lister.listed() } }
    onExited: function(exitCode) { homeRun.exitCode = exitCode; lister.listed() }
  }

  Process {
    id: configRun
    property string root: ""
    property int exitCode: -1
    property bool streamed: false
    workingDirectory: lister.home
    command: ["rg", "--files", "--hidden", "--ignore-file", lister.ignoreFile, configRun.root]
    stdout: StdioCollector { onStreamFinished: { configRun.streamed = true; lister.listed() } }
    onExited: function(exitCode) { configRun.exitCode = exitCode; lister.listed() }
  }

  // ------------------------------------------------------ usage signals

  function readSignals() {
    if (!signalsRun.running) signalsRun.running = true
  }

  function signalsRead(text) {
    lister.signals = FileIndex.parseSignals(text)
    lister.signalsAt = Date.now()
    var touched = lister.subtrees.some(function(t) {
      return lister.signals.some(function(s) { return s === t.path || s.indexOf(t.path + "/") === 0 })
    })
    if (touched) lister.recountDue = true
    lister.counted()
  }

  Process {
    id: signalsRun
    property bool exited: false
    property bool streamed: false
    command: ["bash", "-c", lister.signalsScript, "omacast-signals", lister.home]
    stdout: StdioCollector { id: signalsOut; onStreamFinished: { signalsRun.streamed = true; signalsRun.settle() } }
    onStarted: { signalsRun.exited = false; signalsRun.streamed = false }
    onExited: { signalsRun.exited = true; signalsRun.settle() }
    function settle() { if (signalsRun.exited && signalsRun.streamed) lister.signalsRead(signalsOut.text) }
  }

  // ------------------------------------------- large untouched subtrees

  function recount() {
    if (lister.recounting) return
    lister.recounting = true
    lister.recountDue = false
    lister.recountStartedAt = Date.now()
    recountRun.running = true
    lister.readSignals()
  }

  function counted() {
    if (!lister.recounting || !recountRun.exited || !recountRun.streamed || lister.signalsAt < lister.recountStartedAt) return
    if (recountRun.exitStatus !== 0 || recountRun.code !== 0) {
      lister.recounting = false
      lister.message("warning", "files: recount exited " + (recountRun.exitStatus ? "abnormally" : recountRun.code) + " for " + lister.home + "; keeping the previous large subtrees", null)
      return
    }
    var counts = FileIndex.parseCounts(recountOut.text)
    var found = FileIndex.largeSubtrees(counts, lister.signals, FileIndex.DEFAULT_THRESHOLD, lister.home)
    var changed = JSON.stringify(found) !== JSON.stringify(lister.subtrees)
    lister.subtrees = found
    lister.recountedAt = Date.now()
    lister.recountFiles = counts[lister.home] || 0
    lister.message("info", "files: counted " + lister.recountFiles + " paths, " + found.length + " large untouched subtrees in "
      + (lister.recountedAt - lister.recountStartedAt) + " ms", null)
    lister.save("replace", lister.stateFile, JSON.stringify({ recountedAt: lister.recountedAt, files: lister.recountFiles, subtrees: found }) + "\n", null)
    lister.save("replace", lister.untouchedFile, FileIndex.ignoreFileText(found, lister.home), function() {
      lister.recounting = false
      if (changed || !lister.listedAt) lister.refreshSoon()
    })
  }

  function refreshSoon() {
    if (!lister.refresh(lister.defaultRoots)) lister.listedAt = 0
  }

  Process {
    id: recountRun
    property bool exited: false
    property bool streamed: false
    property int code: -1
    property int exitStatus: -1
    workingDirectory: lister.home
    command: ["bash", "-c", FileIndex.RECOUNT_SCRIPT, "omacast-recount", lister.home, FileIndex.COUNT_PROGRAM, String(FileIndex.DEFAULT_THRESHOLD)]
    stdout: StdioCollector { id: recountOut; onStreamFinished: { recountRun.streamed = true; lister.counted() } }
    onStarted: { recountRun.exited = false; recountRun.streamed = false }
    onExited: function(exitCode, exitStatus) {
      recountRun.code = exitCode
      recountRun.exitStatus = exitStatus
      recountRun.exited = true
      lister.counted()
    }
  }

  // ------------------------------------------------------ the ignore file

  function ignore(path) {
    if (FileIndex.ignores(lister.ignoreText, lister.home, path)) return { added: false }
    var line = FileIndex.ignoreLine(lister.home, path)
    var gap = lister.ignoreText && lister.ignoreText.charAt(lister.ignoreText.length - 1) !== "\n" ? "\n" : ""
    lister.ignoreText += gap + line + "\n"
    lister.save("append", lister.ignoreFile, gap + line + "\n", function(ok) { if (ok) lister.refreshSoon() })
    return { added: true, line: line }
  }

  FileView {
    path: lister.ignoreFileReady ? lister.ignoreFile : ""
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      if (lister.ignoreText !== text()) lister.listedAt = 0
      lister.ignoreText = text()
    }
  }

  FileView {
    path: lister.ready ? lister.stateFile : ""
    printErrors: false
    onLoaded: {
      try {
        var state = JSON.parse(text())
        lister.subtrees = Array.isArray(state.subtrees) ? state.subtrees : []
        lister.recountedAt = Number(state.recountedAt) || 0
        lister.recountFiles = Number(state.files) || 0
      } catch (e) {
        lister.message("warning", "files: ignoring unreadable " + path, null)
      }
      lister.stateLoaded = true
    }
    onLoadFailed: lister.stateLoaded = true
  }

  // ---------------------------------------------------------- file writes

  // Contents go on stdin; umask 077 makes every file omacast creates 0600.
  function save(mode, path, text, then) {
    lister.writes = lister.writes.concat([{ mode: mode, path: path, text: text, then: then }])
    if (!writer.running) lister.nextWrite()
  }

  function nextWrite() {
    if (!lister.writes.length) return
    var job = lister.writes[0]
    lister.writes = lister.writes.slice(1)
    writer.mode = job.mode
    writer.path = job.path
    writer.text = job.text
    writer.then = job.then
    writer.stdinEnabled = true
    writer.running = true
  }

  Process {
    id: writer
    property string mode: ""
    property string path: ""
    property string text: ""
    property var then: null
    command: ["bash", "-c", lister.writeScript, "omacast-files", writer.mode, writer.path]
    onStarted: {
      write(writer.text)
      writer.text = ""
      writer.stdinEnabled = false
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) lister.message("error", "files: could not write " + writer.path, { exitCode: exitCode })
      var then = writer.then
      writer.then = null
      if (then) then(exitCode === 0)
      lister.nextWrite()
    }
  }
}
