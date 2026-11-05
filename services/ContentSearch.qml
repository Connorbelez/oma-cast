import QtQuick
import Quickshell.Io
import "../core/FileRanker.js" as FileRanker

// Searches file contents for Search Files (SPEC §8.6). A request is
// { serial, query, roots, startedAt } and its reply { serial, matches, ms,
// killed }. One run at a time: a request made while a cancelled run is still
// exiting starts when that run has exited. The query goes to the script on
// stdin, never into argv, and the script runs from the home dir because rg
// anchors --ignore-file patterns at its working directory.
Item {
  id: service

  required property string home
  required property string ignoreFile
  required property string untouchedFile
  readonly property int killAfterMs: 300
  property var pending: null

  signal message(string level, string text)

  // rg searches every file, private paths included, when an --ignore-file is
  // missing, and an empty pattern matches every line, so both exit first. The
  // roots run at the same time and cat keeps their lines apart. Cold reads
  // bound the run, and rg's default thread count left the home dir at 203 to
  // 219 ms cold against 140 at -j 24 and 111 at -j 48. rg ignores
  // --max-columns under --json and one common word printed 16 MB in 38 ms, so
  // only match lines of at most 4,096 characters reach the shell, for at most
  // 1,000 files.
  readonly property string searchScript: '[[ -f $3 && -r $3 && -f $4 && -r $4 ]] || exit 3; IFS= read -r q && [[ $q ]] || exit 2; cat <(printf "%s\\n" "$q" | rg --json -F -i -f - --max-count 1 --max-filesize 1M -j 32 --ignore-file "$3" --ignore-file "$4" "$1") <(printf "%s\\n" "$q" | rg --json -F -i -f - --max-count 1 --max-filesize 1M -j 32 --hidden --ignore-file "$3" --ignore-file "$4" "$2") | awk \'length($0) <= 4096 && /^\\{"type":"match"/\' | head -n 1000'

  function search(request, callback) {
    service.cancel()
    service.pending = { serial: request.serial, query: request.query, roots: request.roots, startedAt: 0, killed: false, callback: callback }
    service.start()
  }

  function start() {
    var request = service.pending
    if (!request || run.request || run.running) return
    run.request = request
    run.homeRoot = request.roots[0]
    run.configRoot = request.roots[1]
    run.exited = false
    run.streamed = false
    run.code = -1
    run.stdinEnabled = true
    request.startedAt = Date.now()
    run.running = true
    killTimer.restart()
    watchdog.restart()
  }

  // SIGTERM to timeout ends rg and the rest of its process group.
  function cancel() {
    var request = service.pending
    if (!request) return false
    service.pending = null
    killTimer.stop()
    if (run.request === request && run.running) run.signal(15)
    service.message("info", "content: cancelled")
    return true
  }

  // The 300 ms budget [I]: the rows read before the kill still show.
  function kill() {
    var request = service.pending
    if (!request || run.request !== request || !run.running) return
    request.killed = true
    run.signal(15)
    service.message("info", "content: killed at " + service.killAfterMs + " ms")
  }

  function finished() {
    if (!run.exited || !run.streamed) return
    watchdog.stop()
    var request = run.request
    run.request = null
    if (run.code === 3) service.message("warning", "content: an ignore file is missing, so nothing was searched")
    if (request && request === service.pending) {
      service.pending = null
      killTimer.stop()
      var matches = FileRanker.contentMatches(output.text)
      var ms = Date.now() - request.startedAt
      service.message("info", "content: " + matches.length + " files in " + ms + " ms")
      request.callback({ serial: request.serial, matches: matches, ms: ms, killed: request.killed })
    }
    service.start()
  }

  Component.onDestruction: { service.pending = null; if (run.running) run.signal(15) }

  Timer {
    id: killTimer
    interval: service.killAfterMs
    onTriggered: service.kill()
  }

  // Quickshell reports a process that never started with no exited, and
  // timeout sends SIGKILL 2 s after it passes on the kill timer's SIGTERM.
  Timer {
    id: watchdog
    interval: 3000
    onTriggered: {
      service.message("warning", "content: rg did not exit; giving up on it")
      run.exited = true
      run.streamed = true
      service.finished()
    }
  }

  Process {
    id: run
    property var request: null
    property string homeRoot: ""
    property string configRoot: ""
    property bool exited: false
    property bool streamed: false
    property int code: -1
    workingDirectory: service.home
    command: ["timeout", "-k", "2", "5", "bash", "-c", service.searchScript, "omacast-content", run.homeRoot, run.configRoot, service.ignoreFile, service.untouchedFile]
    stdout: StdioCollector { id: output; onStreamFinished: { run.streamed = true; service.finished() } }
    onStarted: {
      run.write(run.request.query + "\n")
      run.stdinEnabled = false
    }
    onExited: function(exitCode, exitStatus) {
      run.code = exitStatus === 0 ? exitCode : -1
      run.exited = true
      service.finished()
    }
  }
}
