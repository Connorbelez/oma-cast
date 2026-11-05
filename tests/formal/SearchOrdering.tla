--------------------------- MODULE SearchOrdering ---------------------------
(***************************************************************************)
(* The async search ordering protocol of omacast's launcher.               *)
(*                                                                         *)
(* Three pieces of QML talk to one helper process:                         *)
(*   ui/LauncherWindow.qml   rebuild(), perform(), actionsForSelected(),   *)
(*                           onShownChanged, onCandidatesRevisionChanged,  *)
(*                           onCalculatorRevisionChanged                   *)
(*   Backend.qml             searchAsync(), rebuildCandidates()            *)
(*   services/NativeSearch.qml  search(), cancel(), invalidate(), load(),  *)
(*                           send(), fail(), receive(), the timeout Timer, *)
(*                           the helper Process (onStarted, onExited)      *)
(*   search/src/protocol.rs  run(): one reply per request line, in order   *)
(*   services/ContentSearch.qml  search(), start(), cancel(), kill(),      *)
(*                           finished(): the Search Files content source,  *)
(*                           one rg run at a time, its own pending slot    *)
(*                                                                         *)
(* QML runs JavaScript on one thread and every handler runs to completion, *)
(* including property-change handlers it triggers. So each action below is *)
(* one JS task: a key press, a timer firing, one line from the helper.     *)
(* Operators whose names start with Ns, Ui or Backend mirror the QML       *)
(* function of the same name; nested calls are nested operator calls.     *)
(*                                                                         *)
(* The user's typed text, pushed view and root filter are folded into one  *)
(* counter, ui.input: every change bumps it. Rows remember the input they  *)
(* were computed for (ui.rowsInput). Candidate sets are versions (ui.cat). *)
(*                                                                         *)
(* The Guard* and Cancel* constants are the protective lines in the code.  *)
(* tests/formal/check.sh sets each from tests/formal/anchors.js, which     *)
(* reads the QML: TRUE when the line is there, FALSE when it is gone.      *)
(***************************************************************************)
EXTENDS Integers, Sequences

CONSTANTS
  GuardPerform,       \* perform(): if (window.searchPending) return
  GuardActions,       \* actionsForSelected(): if (window.searchPending || ...) return []
  GuardSerial,        \* rebuild() callback: serial !== window.searchSerial
  GuardRevision,      \* rebuild() callback: revision !== window.backend.candidatesRevision
  CancelOnRebuild,    \* rebuild(): window.backend.cancelSearch()
  CancelOnHide,       \* onShownChanged: searchSerial++, cancelSearch(), searchPending = false
  CancelOnReindex,    \* Backend.rebuildCandidates(): nativeSearch.cancel()
  InvalidateCancels,  \* NativeSearch.invalidate(): cancel() and request.callback(null)
  ReplyIdCheck,       \* NativeSearch.receive(): drop replies whose id is not pending
  SendOnlyWhenLoaded, \* NativeSearch.search(): else if (service.loaded) service.send()
  CalcSkipsAlert,     \* onCalculatorRevisionChanged: skips the rebuild while an alert is open
  ContentSerialCheck, \* searchContents() callback: reply.serial !== window.searchSerial
  ContentPendingCheck,    \* ContentSearch.finished(): only the pending request's run is delivered
  CancelContentOnRebuild, \* rebuild(): window.cancelContents()
  CancelContentOnHide,    \* onShownChanged: window.cancelContents()
  MaxEvents,          \* bound: user and environment events per behaviour
  MaxReindex          \* bound: candidate reloads per behaviour

VARIABLES
  ui,   \* LauncherWindow + Backend state
  ns,   \* NativeSearch state
  hp,   \* the helper process: its stdin, its loaded catalog, its stdout
  cs,   \* ContentSearch state: the pending request and the rg run
  gh,   \* ghost flags: set when a harm happens, never cleared
  env   \* event budget (bookkeeping for the bounds only)

vars == <<ui, ns, hp, cs, gh, env>>

NoReq == [id |-> 0, input |-> 0, serial |-> 0, rev |-> 0]
NoCatalog == -1
NoInput == -1
\* A content request is named by the serial it carries: the stillness timer
\* starts at most one per rebuild, and every rebuild bumps the serial.
NoCReq == [serial |-> 0, input |-> 0]
NoRun == [serial |-> 0, input |-> 0, killed |-> FALSE]
NoHeld == [serial |-> 0, input |-> 0]

Init ==
  /\ ui = [shown |-> FALSE,      \* Launcher.opened / LauncherWindow.shown
           input |-> 0,          \* query + view + root filter, as a version
           serial |-> 0,         \* LauncherWindow.searchSerial
           pending |-> FALSE,    \* LauncherWindow.searchPending
           overlay |-> "none",   \* "none" | "panel" (actionPanelOpen) | "alert"
           rowsInput |-> 0,      \* the input the visible rows were computed for
           cat |-> 0,            \* Backend.candidates, NativeSearch.ids/.entries
           rev |-> 0,            \* Backend.candidatesRevision
           ctimer |-> FALSE,     \* contentDelay, the 150 ms stillness timer, running
           contentInput |-> NoInput, \* the input the Contents rows were computed for
           cfor |-> NoInput,     \* the input the files view's Contents record belongs to
           held |-> NoHeld]      \* a content reply that landed under the panel or an alert
  /\ ns = [serial |-> 0,         \* NativeSearch.serial (request and load ids)
           loadId |-> 0,
           loaded |-> FALSE,
           disabled |-> FALSE,
           running |-> FALSE,    \* helper.running
           started |-> FALSE,    \* helper's onStarted has run
           req |-> NoReq]        \* NativeSearch.pending (id 0 = null)
  /\ hp = [toH |-> << >>, cat |-> NoCatalog, fromH |-> << >>]
  /\ cs = [req |-> NoCReq,       \* ContentSearch.pending
           run |-> NoRun]        \* the request the rg Process runs for; killed once signalled
  /\ gh = [staleApply |-> FALSE, staleActivate |-> FALSE, badCatalog |-> FALSE,
           staleContent |-> FALSE]
  /\ env = [events |-> 0, reindexes |-> 0]

\* The whole state as one record, so a JS task can be written as a chain of
\* state-to-state operators, in the order the code runs them.
S == [ui |-> ui, ns |-> ns, hp |-> hp, cs |-> cs, gh |-> gh]
Go(T) == ui' = T.ui /\ ns' = T.ns /\ hp' = T.hp /\ cs' = T.cs /\ gh' = T.gh

-----------------------------------------------------------------------------
(* LauncherWindow.rebuild()'s callback: the guard, then applySearch().     *)
(* rows.ok is FALSE when flea hits were computed against another catalog  *)
(* than the ids receive() maps them through.                               *)
(* rows also stands for the root Files section. rootSearch.search ranks    *)
(* file names in the JS task that maps the flea hits (or runs the JS       *)
(* matcher), on the file list of that moment, so the section is part of    *)
(* the same reply and needs no pending slot or reply action of its own.    *)
(* applySearch() replaces every row, so the Contents section goes too.     *)
UiCallback(X, req, rows) ==
  IF (GuardSerial => req.serial = X.ui.serial) /\ (GuardRevision => req.rev = X.ui.rev)
  THEN [X EXCEPT !.ui.rowsInput = rows.input,
                 !.ui.contentInput = NoInput,
                 !.ui.pending = FALSE,
                 !.gh.staleApply = @ \/ rows.input # X.ui.input,
                 !.gh.badCatalog = @ \/ ~rows.ok]
  ELSE X

\* The JS matcher fallback (callback(null)): Backend runs rootSearch.search
\* on the current candidates for the input the request captured.
Fallback(req) == [input |-> req.input, ok |-> TRUE]

NsCancel(X) == [X EXCEPT !.ns.req = NoReq]           \* also stops the timeout

NsSend(X) ==
  IF X.ns.req.id # 0
  THEN [X EXCEPT !.hp.toH = Append(@, [k |-> "search", id |-> X.ns.req.id,
                                       input |-> X.ns.req.input, cat |-> 0])]
  ELSE X

NsLoad(X) ==
  LET id == X.ns.serial + 1
  IN [X EXCEPT !.ns.serial = id, !.ns.loadId = id,
               !.hp.toH = Append(@, [k |-> "load", id |-> id, input |-> 0, cat |-> X.ui.cat])]

\* fail(): give up on the helper for good and answer the pending request
\* with the JS matcher. helper.running = false kills the process.
NsFail(X) ==
  LET req == X.ns.req
      Y == [X EXCEPT !.ns.req = NoReq, !.ns.disabled = TRUE, !.ns.loaded = FALSE,
                     !.ns.running = FALSE, !.ns.started = FALSE,
                     !.hp = [toH |-> << >>, cat |-> NoCatalog, fromH |-> << >>]]
  IN IF req.id # 0 THEN UiCallback(Y, req, Fallback(req)) ELSE Y

NsSearch(X, req) ==
  LET X1 == NsCancel(X)
  IN IF X1.ns.disabled
     THEN UiCallback(X1, req, Fallback(req))
     ELSE LET id == X1.ns.serial + 1
              Y == [X1 EXCEPT !.ns.serial = id, !.ns.req = [req EXCEPT !.id = id]]
          IN IF ~Y.ns.running THEN [Y EXCEPT !.ns.running = TRUE]
             ELSE IF Y.ns.loaded \/ ~SendOnlyWhenLoaded THEN NsSend(Y)
             ELSE Y

\* onEntriesChanged -> invalidate(). Backend has already swapped
\* candidates and ids, so a fallback answer uses the new catalog.
NsInvalidate(X) ==
  LET req == X.ns.req
      X1 == IF InvalidateCancels THEN NsCancel(X) ELSE X
      X2 == [X1 EXCEPT !.ns.loaded = FALSE, !.ns.loadId = 0]
      X3 == IF X2.ns.running THEN NsLoad(X2) ELSE X2
  IN IF InvalidateCancels /\ req.id # 0 THEN UiCallback(X3, req, Fallback(req)) ELSE X3

\* receive(line) for a well-formed reply m.
NsReceive(X, m) ==
  LET req == X.ns.req
      known == (X.ns.loadId # 0 /\ m.id = X.ns.loadId) \/ (req.id # 0 /\ m.id = req.id)
  IN IF ReplyIdCheck /\ ~known THEN X
     ELSE IF X.ns.loadId # 0 /\ m.id = X.ns.loadId
          THEN NsSend([X EXCEPT !.ns.loaded = TRUE])
     \* A stale load reply has no hits (FleaSearch.hits throws), and a reply
     \* with no pending request throws on request.callback: both fail().
     ELSE IF req.id = 0 \/ m.k # "hits" THEN NsFail(X)
     ELSE UiCallback(NsCancel(X), req, [input |-> m.input, ok |-> m.cat = X.ui.cat])

-----------------------------------------------------------------------------
(* The content source: ContentSearch.qml and the view's side of it.        *)

\* ContentSearch.cancel(): drop the pending request, stop the kill timer,
\* and SIGTERM the run when it is the pending request's. A run that is not
\* the pending one was killed when its request was dropped.
CsCancel(X) ==
  IF X.cs.req.serial = 0 THEN X
  ELSE [X EXCEPT !.cs.req = NoCReq,
                 !.cs.run.killed = @ \/ X.cs.run.serial = X.cs.req.serial]

\* window.cancelContents(): contentDelay.stop(), clear the Contents record
\* (its input and any held reply), then ContentSearch.cancel().
UiCancelContents(X) == CsCancel([X EXCEPT !.ui.ctimer = FALSE, !.ui.cfor = NoInput, !.ui.held = NoHeld])

\* ContentSearch.start(): one run at a time. A request made while a killed
\* run is still exiting starts when that run has exited.
CsStart(X) ==
  IF X.cs.req.serial # 0 /\ X.cs.run.serial = 0
  THEN [X EXCEPT !.cs.run = [serial |-> X.cs.req.serial, input |-> X.cs.req.input, killed |-> FALSE]]
  ELSE X

CsSearch(X, r) == CsStart([CsCancel(X) EXCEPT !.cs.req = r])

\* applyContents(), from the content callback or applyHeld(): the serial
\* guard, then a reply that lands under the panel or an alert is held;
\* otherwise the section goes in.
UiContents(X, r) ==
  IF ContentSerialCheck => r.serial = X.ui.serial
  THEN IF X.ui.overlay # "none"
       THEN [X EXCEPT !.ui.held = r]
       ELSE [X EXCEPT !.ui.contentInput = r.input,
                      !.gh.staleContent = @ \/ r.input # X.ui.input]
  ELSE X

\* A rebuild for the input of the files view's Contents record, such as a
\* list refresh, new signals or a toast. The serial stays, nothing about
\* contents is cancelled or restarted, and the synchronous answer puts the
\* kept section back under the new rows.
KeepRebuild(X) ==
  LET X1 == IF CancelOnRebuild THEN NsCancel(X) ELSE X
  IN [NsCancel(X1) EXCEPT !.ui.rowsInput = X1.ui.input, !.ui.pending = FALSE]

\* rebuild() through Backend.searchAsync(). The first set member is the
\* synchronous path (empty query, pushed or alias view, JS matcher); the
\* second is a root query handed to NativeSearch. The files view is a
\* synchronous view and the only one that restarts contentDelay and claims
\* the Contents record for this input; it is open only while shown, because
\* popToRoot(), the one rebuild while hidden, leaves it first.
UiRebuild(X) ==
  IF X.ui.cfor = X.ui.input THEN {KeepRebuild(X)} ELSE
  LET serial == X.ui.serial + 1
      X1 == [X EXCEPT !.ui.serial = serial]
      X2 == IF CancelOnRebuild THEN NsCancel(X1) ELSE X1
      X2c == IF CancelContentOnRebuild THEN UiCancelContents(X2) ELSE X2
      X3 == [X2c EXCEPT !.ui.pending = TRUE]
      req == [id |-> 0, input |-> X3.ui.input, serial |-> serial, rev |-> X3.ui.rev]
      X4 == NsCancel(X3)                     \* searchAsync(): nativeSearch.cancel()
      Sync == UiCallback(X4, req, Fallback(req))
  IN { Sync, NsSearch(X4, req) }
     \cup (IF X4.ui.shown THEN {[Sync EXCEPT !.ui.ctimer = TRUE, !.ui.cfor = X4.ui.input, !.ui.held = NoHeld]} ELSE {})

-----------------------------------------------------------------------------
(* User and environment events. Each costs one unit of the event budget.   *)
Spend == env.events < MaxEvents /\ env' = [env EXCEPT !.events = @ + 1]

\* Launcher.open() -> prepare() -> rebuild(true), in one JS task.
Show == Spend /\ (~ui.shown /\ \E T \in UiRebuild([S EXCEPT !.ui.shown = TRUE]) : Go(T))

\* Launcher.close() -> onShownChanged with shown false, closePopups().
Hide == Spend /\ (ui.shown /\
  LET Y == [S EXCEPT !.ui.shown = FALSE, !.ui.overlay = "none"]
      Y1 == IF CancelOnHide THEN NsCancel([Y EXCEPT !.ui.serial = @ + 1, !.ui.pending = FALSE])
            ELSE Y
  IN Go(IF CancelContentOnHide THEN UiCancelContents(Y1) ELSE Y1))

\* popTimer -> popToRoot() while hidden.
PopToRoot == Spend /\ (~ui.shown /\ \E T \in UiRebuild([S EXCEPT !.ui.input = @ + 1]) : Go(T))

\* setQuery, push, pop, setRootFilter, recallHistory: input changes, rebuild.
Edit == Spend /\ (ui.shown /\ ui.overlay = "none" /\
  \E T \in UiRebuild([S EXCEPT !.ui.input = @ + 1]) : Go(T))

\* The selected row is a name row, or a Contents row when that section shows.
\* TRUE when the row was computed for something other than the input now.
StaleRow == {ui.rowsInput # ui.input} \cup
            (IF ui.contentInput # NoInput THEN {ui.contentInput # ui.input} ELSE {})

\* perform(): Enter, Ctrl+Enter, Ctrl+1..9, a click, or an action-panel
\* entry. The outcome opens an alert, rebuilds for a toast, or neither.
Activate == Spend /\ (ui.shown /\ ui.overlay \in {"none", "panel"} /\ (GuardPerform => ~ui.pending) /\
  \E stale \in StaleRow :
    LET X == [S EXCEPT !.ui.overlay = "none",
                       !.gh.staleActivate = @ \/ stale]
    IN \E T \in {X, [X EXCEPT !.ui.overlay = "alert"]} \cup UiRebuild(X) : Go(T))

\* toggleActionPanel() -> actionsForSelected(): the panel lists actions for
\* the selected row, so opening it on stale rows offers a stale row's actions.
OpenPanel == Spend /\ (ui.shown /\ ui.overlay = "none" /\ (GuardActions => ~ui.pending) /\
  \E stale \in StaleRow :
    Go([S EXCEPT !.ui.overlay = "panel",
                 !.gh.staleActivate = @ \/ stale]))

\* Esc on the panel or alert; confirmAlert() may rebuild for a toast or push.
CloseOverlay == Spend /\ (ui.overlay # "none" /\
  LET X == [S EXCEPT !.ui.overlay = "none"]
  IN \E T \in (IF ui.overlay = "alert" THEN {X} \cup UiRebuild(X) ELSE {X}) : Go(T))

\* Exchange rates or zone offsets arrive: onCalculatorRevisionChanged.
CalcRevision == Spend /\ (ui.shown /\ ui.overlay # "panel" /\ (CalcSkipsAlert => ui.overlay # "alert") /\
  \E T \in UiRebuild(S) : Go(T))

\* Backend.rebuildCandidates() (apps or Omarchy menu changed), then
\* onCandidatesRevisionChanged. Its own budget, so it is not starved.
Reindex ==
  /\ env.reindexes < MaxReindex
  /\ env' = [env EXCEPT !.reindexes = @ + 1]
  /\ LET X1 == IF CancelOnReindex THEN NsCancel(S) ELSE S
         X2 == NsInvalidate([X1 EXCEPT !.ui.cat = @ + 1])
         X3 == [X2 EXCEPT !.ui.rev = @ + 1]
         fire == X3.ui.shown /\ X3.ui.overlay = "none"
     IN \E T \in (IF fire THEN UiRebuild(X3) ELSE {X3}) : Go(T)

-----------------------------------------------------------------------------
(* The helper process and NativeSearch's own events.                       *)

\* helper onStarted -> load(). Writes made before this are buffered in
\* order (assumption; a dropped early load changes nothing because this
\* load gets a newer loadId).
HelperStart == ns.running /\ ~ns.started /\ UNCHANGED env /\
  Go(NsLoad([S EXCEPT !.ns.started = TRUE]))

\* protocol.rs run(): read one line, answer it, flush. Searches run against
\* whatever catalog the last load installed.
HelperStep == ns.started /\ hp.toH # << >> /\ UNCHANGED <<ui, ns, cs, gh, env>> /\
  LET m == Head(hp.toH)
  IN hp' = [toH |-> Tail(hp.toH),
            cat |-> IF m.k = "load" THEN m.cat ELSE hp.cat,
            fromH |-> Append(hp.fromH,
                        IF m.k = "load"
                        THEN [k |-> "loaded", id |-> m.id, input |-> 0, cat |-> m.cat]
                        ELSE [k |-> "hits", id |-> m.id, input |-> m.input, cat |-> hp.cat])]

\* SplitParser onRead -> receive(line). The second branch is a line that
\* FleaSearch.reply/hits rejects, or an error reply: both reach fail().
Receive == hp.fromH # << >> /\ UNCHANGED env /\
  LET m == Head(hp.fromH)
      X == [S EXCEPT !.hp.fromH = Tail(@)]
  IN Go(NsReceive(X, m)) \/ Go(NsFail(X))

\* The 1 s timeout Timer runs exactly while a request is pending.
Timeout == ns.req.id # 0 /\ UNCHANGED env /\ Go(NsFail(S))

\* helper onExited while not yet disabled.
HelperExit == ns.running /\ ~ns.disabled /\ UNCHANGED env /\ Go(NsFail(S))

-----------------------------------------------------------------------------
(* The content source's own events.                                        *)

\* contentDelay fires -> searchContents(): Backend runs the reveal rule
\* (the first member, nothing starts) or ContentSearch.search() with the
\* serial and the query of this moment.
ContentFire == ui.ctimer /\ UNCHANGED env /\
  LET X == [S EXCEPT !.ui.ctimer = FALSE]
  IN Go(X) \/ Go(CsSearch(X, [serial |-> ui.serial, input |-> ui.input]))

\* The 300 ms kill timer runs exactly while the pending request's run is
\* unkilled. kill() signals the run and keeps the request pending, so the
\* rows read before the kill are still delivered.
ContentKill == cs.req.serial # 0 /\ cs.run.serial = cs.req.serial /\ ~cs.run.killed /\
  UNCHANGED env /\ Go([S EXCEPT !.cs.run.killed = TRUE])

\* The run exits on its own or from a signal, its output is read, and
\* finished() delivers it when it is the pending request's run, then
\* starts a request that waited. The watchdog finishes only a run whose
\* process never started, which is the same step.
ContentExit == cs.run.serial # 0 /\ UNCHANGED env /\
  LET r == [serial |-> cs.run.serial, input |-> cs.run.input]
      current == cs.req.serial = cs.run.serial
      X == [S EXCEPT !.cs.run = NoRun]
      X1 == IF current THEN [X EXCEPT !.cs.req = NoCReq] ELSE X
      X2 == IF current \/ ~ContentPendingCheck THEN UiContents(X1, r) ELSE X1
  IN Go(CsStart(X2))

\* Qt.callLater(applyHeld) after the panel or alert closes. The held reply
\* goes through applyContents(), serial guard first.
ApplyHeld == ui.held # NoHeld /\ ui.overlay = "none" /\ UNCHANGED env /\
  Go(UiContents([S EXCEPT !.ui.held = NoHeld], ui.held))

Next ==
  \/ Show \/ Hide \/ PopToRoot \/ Edit \/ Activate \/ OpenPanel \/ CloseOverlay
  \/ CalcRevision \/ Reindex
  \/ HelperStart \/ HelperStep \/ Receive \/ Timeout \/ HelperExit
  \/ ContentFire \/ ContentKill \/ ContentExit \/ ApplyHeld

\* The helper and the timer make progress; the user may stop at any time.
Spec == Init /\ [][Next]_vars
        /\ WF_vars(HelperStart) /\ WF_vars(HelperStep) /\ WF_vars(Receive)
        /\ WF_vars(Timeout)

-----------------------------------------------------------------------------
(* Properties.                                                             *)

\* Enter, a click, Ctrl+1..9 or the action panel never act on rows that
\* were computed for something other than what the user has typed now.
NoStaleActivation == ~gh.staleActivate

\* Results for an older query never replace the rows for the current one.
NoStaleOverwrite == ~gh.staleApply

\* Flea hits are only mapped to ids from the catalog they were computed on;
\* otherwise hit.index points at a different app or command.
RepliesMatchCatalog == ~gh.badCatalog

\* Whenever the launcher is visible and not waiting, its rows belong to the
\* current input, and so does a Contents section.
SettledRowsAreCurrent == (ui.shown /\ ~ui.pending) =>
  (ui.rowsInput = ui.input /\ ui.contentInput \in {NoInput, ui.input})

\* A content reply for an older query never reaches the list.
NoStaleContent == ~gh.staleContent

\* A keystroke or view change kills the rg run: a run that has not been
\* signalled belongs to the current search serial.
ContentRunsAreCurrent == (cs.run.serial # 0 /\ ~cs.run.killed) => cs.run.serial = ui.serial

\* A hide kills the rg run and stops the stillness timer, so no content
\* search runs or starts while the launcher is hidden.
HiddenRunsNoContent == ~ui.shown => (~ui.ctimer /\ (cs.run.serial = 0 \/ cs.run.killed))

\* A search the visible launcher waits on always finishes (or the launcher
\* hides): Enter never stays dead.
SearchSettles == (ui.pending /\ ui.shown) ~> (~ui.pending \/ ~ui.shown)

=============================================================================
