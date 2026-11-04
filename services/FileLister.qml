import QtQuick
import Quickshell.Io
import "../core/FileIndex.js" as FileIndex

// Holds the file list for file search (SPEC §8.6). Every process runs a fixed
// argv of constant scripts, flags, roots and omacast's own files, from the home
// dir because rg anchors --ignore-file patterns at the working directory.
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
  property bool dirty: false
  property double refreshStartedAt: 0
  property bool ignoreRetried: false

  property var subtrees: []
  property double recountedAt: 0
  property int recountFiles: 0
  property bool recounting: false
  property bool recountDue: false
  property bool recountAfterRefresh: false
  property double recountStartedAt: 0

  property var signals: []
  property double signalsAt: 0

  property string ignoreText: ""
  property var reportedLines: []
  property bool ignoreFileReady: false
  property bool stateLoaded: false
  property bool started: false
  property var writes: []
  property bool writing: false

  signal message(string level, string text, var metadata)

  // create fills a temp file and moves it in only while the target is
  // missing, so a write killed halfway never leaves an empty file behind.
  readonly property string writeScript: 'umask 077; case $1 in create) [[ -e $2 ]] && exec cat >/dev/null; rm -f -- "$2.tmp"; cat >"$2.tmp" || exit 1; mv -n -- "$2.tmp" "$2"; rm -f -- "$2.tmp"; [[ -e $2 ]]; exit ;; append) exec cat >>"$2" ;; replace) rm -f -- "$2.tmp"; cat >"$2.tmp" && exec mv -f -- "$2.tmp" "$2" ;; esac; exit 2'
  // rg lists every file, private paths included, when an --ignore-file is
  // missing or unreadable, and still exits 0. Exit 3 means "restore them first".
  readonly property string listScript: '[[ -f $2 && -r $2 && -f $3 && -r $3 ]] || exit 3; exec rg --files "${@:4}" --ignore-file "$2" --ignore-file "$3" "$1"'
  readonly property string signalsScript: "zoxide query --list --score 2>/dev/null; fd -H -t f -p '/\\.git/logs/HEAD$' --changed-within 14d --max-depth 8 --exclude node_modules \"$1\" 2>/dev/null; exit 0"

  onReadyChanged: {
    if (!lister.ready) return
    lister.save("create", lister.ignoreFile, FileIndex.defaultIgnoreText(), function() { lister.ignoreFileReady = true })
  }

  function begin() {
    if (lister.started || !lister.ignoreFileReady || !lister.stateLoaded) return
    lister.save("replace", lister.untouchedFile, FileIndex.ignoreFileText(lister.subtrees, lister.home), function() {
      lister.started = true
      lister.catchUp(0)
    })
  }
  onIgnoreFileReadyChanged: lister.begin()
  onStateLoadedChanged: lister.begin()

  // The list refreshes when the launcher hides, where nothing competes with
  // typing or painting. The previous list answers until a refresh lands.
  function hidden() {
    if (lister.started) lister.catchUp(FileIndex.REFRESH_AFTER_MS)
  }

  // A due recount waits for the refresh, so the list never queues behind it.
  function catchUp(maxAgeMs) {
    if (lister.stale(maxAgeMs)) lister.refresh(lister.defaultRoots)
    if (!lister.recountDue && Date.now() - lister.recountedAt < FileIndex.RECOUNT_MS) return
    if (lister.refreshing) lister.recountAfterRefresh = true
    else lister.recount()
  }

  // An open refreshes only a list kept through a long session, and after
  // the launcher's first frames instead of queueing behind them.
  function opened() {
    if (lister.started && lister.stale(FileIndex.OPEN_REFRESH_AFTER_MS)) openRefresh.restart()
  }

  function stale(maxAgeMs) {
    return !lister.refreshing && (lister.dirty || Date.now() - lister.listedAt > maxAgeMs)
  }

  Timer {
    id: openRefresh
    interval: 250
    onTriggered: if (lister.stale(FileIndex.OPEN_REFRESH_AFTER_MS)) lister.refresh(lister.defaultRoots)
  }

  // ------------------------------------------------------------- the list

  // A request that cannot start now marks the list dirty, and the refresh
  // that finishes next starts one more.
  function refresh(roots) {
    if (lister.refreshing || !lister.started || !lister.recountedAt || homeRun.running || configRun.running) {
      lister.dirty = true
      return false
    }
    lister.dirty = false
    lister.refreshing = true
    lister.refreshStartedAt = Date.now()
    homeRun.root = roots[0]
    configRun.root = roots[1] || ""
    for (var run of [homeRun, configRun]) { run.exited = false; run.streamed = false }
    homeRun.running = true
    if (configRun.root) configRun.running = true
    refreshWatchdog.restart()
    return true
  }

  function runDone(run) { return run.exited && run.streamed }

  function listed() {
    if (!lister.refreshing || !lister.runDone(homeRun) || (configRun.root && !lister.runDone(configRun))) return
    refreshWatchdog.stop()
    lister.refreshing = false
    lister.readSignals()
    var runs = (configRun.root ? [homeRun, configRun] : [homeRun]).map(function(run) {
      return { root: run.root, exitCode: run.code, exitStatus: run.exitStatus, text: run.stdout.text }
    })
    var outcome = FileIndex.listOutcome(runs)
    if (outcome.missing) {
      lister.restoreIgnoreFiles()
      return
    }
    lister.ignoreRetried = false
    if (outcome.warnings) outcome.warnings.forEach(function(text) { lister.message("warning", text, null) })
    if (outcome.rows) {
      lister.rows = outcome.rows
      lister.roots = runs.map(function(run) { return run.root })
      lister.listedAt = Date.now()
      lister.listMs = lister.listedAt - lister.refreshStartedAt
      lister.message("info", "files: listed " + outcome.rows.length + " paths in " + lister.listMs + " ms", null)
    }
    if (lister.dirty) lister.refresh(lister.defaultRoots)
    else if (lister.recountAfterRefresh) {
      lister.recountAfterRefresh = false
      lister.recount()
    }
  }

  // Recreates a missing ignore file from the defaults and the untouched file
  // from the last recount, then lists once more. A second miss keeps the list.
  function restoreIgnoreFiles() {
    if (lister.ignoreRetried) {
      lister.ignoreRetried = false
      lister.message("warning", "files: ignore file missing, keeping the previous list", null)
      return
    }
    lister.ignoreRetried = true
    lister.message("info", "files: an ignore file is missing; recreating it", null)
    lister.save("create", lister.ignoreFile, FileIndex.defaultIgnoreText(), null)
    lister.save("create", lister.untouchedFile, FileIndex.ignoreFileText(lister.subtrees, lister.home), function() {
      ignoreView.reload()
      lister.refresh(lister.defaultRoots)
    })
  }

  Process {
    id: homeRun
    property string root: ""
    property bool exited: false
    property bool streamed: false
    property int code: -1
    property int exitStatus: -1
    workingDirectory: lister.home
    command: ["timeout", "-k", "2", "15", "bash", "-c", lister.listScript, "omacast-files", homeRun.root, lister.ignoreFile, lister.untouchedFile]
    stdout: StdioCollector { onStreamFinished: { homeRun.streamed = true; lister.listed() } }
    onExited: function(exitCode, exitStatus) {
      homeRun.code = exitCode
      homeRun.exitStatus = exitStatus
      homeRun.exited = true
      lister.listed()
    }
  }

  Process {
    id: configRun
    property string root: ""
    property bool exited: false
    property bool streamed: false
    property int code: -1
    property int exitStatus: -1
    workingDirectory: lister.home
    command: ["timeout", "-k", "2", "15", "bash", "-c", lister.listScript, "omacast-files", configRun.root, lister.ignoreFile, lister.untouchedFile, "--hidden"]
    stdout: StdioCollector { onStreamFinished: { configRun.streamed = true; lister.listed() } }
    onExited: function(exitCode, exitStatus) {
      configRun.code = exitCode
      configRun.exitStatus = exitStatus
      configRun.exited = true
      lister.listed()
    }
  }

  // ------------------------------------------------------ usage signals

  function readSignals() {
    if (!signalsRun.running) signalsRun.running = true
  }

  function signalsRead(exitCode, exitStatus, text) {
    if (exitStatus === 0 && exitCode === 0) lister.signals = FileIndex.parseSignals(text)
    else lister.message("warning", "files: signals " + (exitStatus === 0 && exitCode === 124 ? "timed out" : "exited abnormally") + "; keeping the previous signals", null)
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
    property int code: -1
    property int exitStatus: -1
    workingDirectory: lister.home
    command: ["timeout", "-k", "2", "15", "bash", "-c", lister.signalsScript, "omacast-signals", lister.home]
    stdout: StdioCollector { id: signalsOut; onStreamFinished: { signalsRun.streamed = true; signalsRun.settle() } }
    onStarted: { signalsRun.exited = false; signalsRun.streamed = false }
    onExited: function(exitCode, exitStatus) {
      signalsRun.code = exitCode
      signalsRun.exitStatus = exitStatus
      signalsRun.exited = true
      signalsRun.settle()
    }
    function settle() { if (signalsRun.exited && signalsRun.streamed) lister.signalsRead(signalsRun.code, signalsRun.exitStatus, signalsOut.text) }
  }

  // ------------------------------------------- large untouched subtrees

  function recount() {
    if (lister.recounting || recountRun.running) return
    lister.recounting = true
    lister.recountDue = false
    lister.recountStartedAt = Date.now()
    recountRun.exited = false
    recountRun.streamed = false
    recountRun.running = true
    recountWatchdog.restart()
    lister.readSignals()
  }

  function counted() {
    if (!lister.recounting || !recountRun.exited || !recountRun.streamed || lister.signalsAt < lister.recountStartedAt) return
    var outcome = FileIndex.recountOutcome({ exitCode: recountRun.code, exitStatus: recountRun.exitStatus, text: recountOut.text }, lister.home)
    if (outcome.warnings) outcome.warnings.forEach(function(text) { lister.message("warning", text, null) })
    if (!outcome.counts) {
      recountWatchdog.stop()
      lister.recounting = false
      return
    }
    var counts = outcome.counts
    var found = FileIndex.largeSubtrees(counts, lister.signals, FileIndex.DEFAULT_THRESHOLD, lister.home)
    var changed = JSON.stringify(found) !== JSON.stringify(lister.subtrees)
    lister.subtrees = found
    lister.recountedAt = Date.now()
    lister.recountFiles = counts[lister.home] || 0
    lister.message("info", "files: counted " + lister.recountFiles + " paths, " + found.length + " large untouched subtrees in "
      + (lister.recountedAt - lister.recountStartedAt) + " ms", null)
    lister.save("replace", lister.stateFile, JSON.stringify({ recountedAt: lister.recountedAt, files: lister.recountFiles, subtrees: found }) + "\n", null)
    lister.save("replace", lister.untouchedFile, FileIndex.ignoreFileText(found, lister.home), function() {
      recountWatchdog.stop()
      lister.recounting = false
      if (changed || !lister.listedAt || lister.dirty) lister.refresh(lister.defaultRoots)
    })
  }

  Process {
    id: recountRun
    property bool exited: false
    property bool streamed: false
    property int code: -1
    property int exitStatus: -1
    workingDirectory: lister.home
    command: ["timeout", "-k", "2", "60", "bash", "-c", FileIndex.RECOUNT_SCRIPT, "omacast-recount", lister.home, FileIndex.COUNT_PROGRAM, String(FileIndex.DEFAULT_THRESHOLD)]
    stdout: StdioCollector { id: recountOut; onStreamFinished: { recountRun.streamed = true; lister.counted() } }
    onExited: function(exitCode, exitStatus) {
      recountRun.code = exitCode
      recountRun.exitStatus = exitStatus
      recountRun.exited = true
      lister.counted()
    }
  }

  // timeout ends each stage's whole process group and exits 124. These
  // watchdogs cover a process that never started, which Quickshell reports
  // with no exited, and a timeout that is itself stuck; SIGTERM to timeout
  // passes on to the group.
  function giveUp(stage, runs) {
    runs.forEach(function(run) { if (run.running) run.signal(15) })
    lister.message("warning", "files: " + stage + " timed out", null)
  }

  Timer {
    id: refreshWatchdog
    interval: 20000
    onTriggered: {
      lister.refreshing = false
      lister.giveUp("refresh", [homeRun, configRun])
    }
  }

  Timer {
    id: recountWatchdog
    interval: 65000
    onTriggered: {
      lister.recounting = false
      lister.giveUp("recount", [recountRun, signalsRun])
    }
  }

  // ------------------------------------------------------ the ignore file

  // An append to a deleted ignore file would leave only the new line, and
  // rg would then list the private paths, so the defaults go in first.
  function ignore(path) {
    if (FileIndex.ignores(lister.ignoreText, lister.home, path)) return { added: false }
    var line = FileIndex.ignoreLine(lister.home, path)
    var gap = lister.ignoreText && lister.ignoreText.charAt(lister.ignoreText.length - 1) !== "\n" ? "\n" : ""
    lister.ignoreText += gap + line + "\n"
    lister.save("create", lister.ignoreFile, FileIndex.defaultIgnoreText(), null)
    lister.save("append", lister.ignoreFile, gap + line + "\n", function(ok) { if (ok) lister.refresh(lister.defaultRoots) })
    return { added: true, line: line }
  }

  FileView {
    id: ignoreView
    path: lister.ignoreFileReady ? lister.ignoreFile : ""
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      var changed = lister.ignoreText !== text()
      lister.ignoreText = text()
      FileIndex.badIgnoreLines(lister.ignoreText).forEach(function(line) {
        if (lister.reportedLines.indexOf(line) >= 0) return
        lister.reportedLines.push(line)
        lister.message("warning", "files: rg cannot read the ignore line " + JSON.stringify(line) + ", so it matches nothing", null)
      })
      if (changed) lister.refresh(lister.defaultRoots)
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
  // Quickshell reports running as false inside onExited, where a callback
  // may save again, so the writing flag holds each job until the last exits.
  function save(mode, path, text, then) {
    lister.writes = lister.writes.concat([{ mode: mode, path: path, text: text, then: then }])
    lister.nextWrite()
  }

  function nextWrite() {
    if (lister.writing || !lister.writes.length) return
    lister.writing = true
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
      lister.writing = false
      lister.nextWrite()
      if (then) then(exitCode === 0)
    }
  }
}
