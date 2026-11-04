---
name: verify-omacast
description: Drive the live omacast launcher (the typecraft.omacast plugin inside omarchy-shell on Hyprland) the way a user does, and capture proof. Use it to show that a change to Launcher.qml, Backend.qml, ui/, services/ or core/ works in the real launcher, not only in node tests. Use it for every Phase acceptance check in SPEC.md §12, and whenever someone asks you to run, screenshot or demo omacast.
---

# Verify omacast in the live shell

omacast is not a standalone app. It's a plugin loaded into `omarchy-shell`, the user's one long-lived Quickshell process, which also draws their bar and menus. Its surfaces are:
- **The launcher overlay**: a Wayland layer with namespace `omacast`, driven by keyboard. This is the primary surface.
- **The `omacast` CLI and IPC**: `omarchy-shell omacast <fn>` and `omacast call <method> [json]`.
- **Side effects**: the clipboard, Omarchy's OSD (the HUD), launched apps, and JSON stores under `~/.local/share/omacast/db/`.

Everything goes through `scripts/omacast-verify` next to this file. From the repo root:

```sh
V=.agents/skills/verify-omacast/scripts/omacast-verify   # or .claude/skills/… (same file)
$V            # help
```

## No isolation: read this first

- **One shared instance.** There's one shell per session, and the plugin uses the user's real XDG dirs (`~/.config/omacast`, `~/.local/share/omacast`, `~/.cache/omacast`, `~/.local/state/omacast`). You can't start a second instance. Never run two verification runs at once, and never drive it while the user is typing into it. `launch` refuses to start while another run is active.
- **The seat is shared.** Keys go to whatever holds keyboard focus. `type` and `key` refuse unless the `omacast` layer is mapped and the plugin reports open. Never send keys any other way (CLAUDE.md: keys within about 40 ms of `show` land in the window underneath, usually the user's terminal).
- **↵ runs real things.** Root rows include Shut Down, Install › Browser › Firefox, Nightlight toggles and web searches. Press ↵ only on rows the feature files name as safe. `omacast-verify run <id>` skips confirmation alerts, so never `run` a power or delete command.

## Launch

```sh
$V launch
```
- Records what already exists in `<run>/run.env`: plugin links, data dirs and the checkout's commit.
- If the plugin isn't installed: runs `bin/omacast install`. That links this checkout into `~/.config/omarchy/plugins/typecraft.omacast`, enables it, links the CLI into `~/.local/bin`, and creates the data dirs and stores (migrations run on first load). It doesn't bind a hotkey.
- If this checkout is already linked: runs `bin/omacast reload`, so the shell loads the current files. Quickshell caches QML by path, so an edit is invisible until reload.
- Refuses when a marketplace copy is installed (a real directory, not a symlink). Verify that copy by hand, or remove it first with the user's consent.
- **Ready** means IPC answers `ping` and `system.info` reports candidates. Without the flea-search helper (`bin/build-search` needs cargo), the first query logs `Search helper exited; using the built-in matcher`. That's expected.

## Doctor (read-only, run first whenever anything looks off)

```sh
$V doctor
```
It checks:
- IPC answers, and exactly one plugin link points at this checkout.
- More than 300 root candidates (apps plus the Omarchy menu), and the backend health ping.
- No omacast QML errors in the last 400 shell-log lines. A QML error shows up as "Type X unavailable", with the cause on the next line. Read them with `$V log 120`.
- Whether the helper is built, the launcher's open state, and the checkout commit (`+dirty` means uncommitted edits).

## Drive

| Step | Command | Notes |
|---|---|---|
| Open at root, empty query | `$V open` | Summons with `{"query":""}`, waits for the layer, then presses Shift+Esc twice to close popups and pop any stale pushed view. The view stack survives hide/show for `popToRootTimeout` (90 s). |
| Type | `$V type "17*3"` | Uses `hypruse keyboard type`, which goes to the layer holding the keyboard grab. Test strings only; never anything private. |
| Press | `$V key enter` / `down` / `ctrl+k` / `shift+escape` / `backspace` / `ctrl+u` | Key names follow `hypruse keyboard key`. |
| Run a command | `$V run builtin:calculator-history` | The same as `omacast run`: pops to root, then pushes or closes. |
| Hide | `$V hide` | Waits until the layer unmaps. |
| Backend state | `$V call <method> '<json>'`, `$V titles "<query>"` | `titles` prints root sections and row titles from `rootSearch.search`. Full method list: `$V call system.info \| jq .data.methods`. |

Stable handles are row ids, not screen positions: `builtin:calculator-history`, `builtin:omarchy-menu`, `omarchy:trigger`, `omarchy:trigger.toggle.nightlight`. List more with `$V call rootSearch.search '{"query":"<q>"}' | jq '.data[].rows[] | {id,title}'`.

## Evidence

- `$V shot <slug>` saves the focused monitor to `<run>/<slug>.png` (mode 0600). The overlay is a layer, not a window, so the capture is the whole monitor, including the user's other windows. Treat it as private. Crop before sharing: the launcher sits at about x 690–1880, y 400–1160 on the 2560×1600 dev monitor (`magick in.png -crop 1200x760+680+400 out.png`).
- Every `call`, `type`, `key`, `run` and `shot` is appended with a timestamp to `<run>/transcript.log`.
- Run dirs live under `${XDG_STATE_HOME:-~/.local/state}/omacast-verify/<run-id>/` (0700), outside the repo, and survive cleanup.
- **Proof standard:**
  - Go through the real user path: keys in the overlay, or the CLI where a user would use the CLI. A backend `call` is a second view of state, never the action under test.
  - Capture the action and the resulting state: a screenshot before and after ↵, not only the last screen.
  - Check side effects alongside the screen. Clipboard: `wl-paste -n`, only for text this run put there. Stores: `$V call calculator.historyGetAll`, `settings.getAllCommandSettings`, `frecency.get`. HUD: the OSD in a screenshot taken within 1.5 s.
  - Say which feature file and entry point each artifact proves.
- The latency budget (show → mapped and hide → unmapped under 100 ms) is measured by `tests/smoke.sh`. Run it during a verification run, never in parallel with key driving.

## Cleanup

```sh
$V cleanup
```
- Hides the launcher.
- If this run installed the plugin, runs `bin/omacast uninstall` (non-interactive, so a hotkey file is kept) and removes only the data dirs that didn't exist before `launch`. Files the run added inside a dir that already existed (for example `~/.cache/omacast/currencies.json`) stay.
- If the plugin was linked before the run, it stays installed. Undo your own store changes first, as each feature's Gotchas say.
- Prints the evidence directory, which is never deleted. Never kill `omarchy-shell` or `qs`: that's the user's whole desktop shell.

## Feature map

`features/README.md` indexes one file per user-facing feature: what it is, every entry point, the exact drive steps, and the end state that proves it. A proof that uses one entry point is incomplete when the file lists others. Phase 7 (file search, `SPEC.md` §8.6) adds `features/file-search.md` when it lands. Keep this map in step with the app using `/maintain-verification-skill`.
