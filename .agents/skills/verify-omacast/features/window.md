# Launcher window

The launcher is an overlay layer (namespace `omacast`) that appears centred over the current monitor, takes the keyboard, and disappears on Escape, on a launch, or when toggled. It keeps its query and pushed view for `popToRootTimeout` seconds (default 90) after hiding.

## Sub-features

- `window-show` shows the launcher with keyboard focus in the search field.
- `window-hide` hides it and returns focus to the previous window.
- `window-toggle` flips between the two.
- `window-escape` follows `escapeKeyBehavior`: `pop-back-or-close` (default) clears the query, then pops, then closes; `close-and-pop-to-root` closes at once.
- `window-pop-to-root` resets to root after the timeout, or immediately when the timeout is 0.
- `window-latency` show → mapped and hide → unmapped each take under 100 ms.

## How to get to it (user POV)

- Press Alt+Space. This only works after `omacast setup hyprland` has written `~/.config/hypr/omacast.lua`.
- Run `omacast toggle`, `omacast show` or `omacast hide` in a terminal.
- Run any `omacast run <commandId>` that pushes a view; it shows the launcher.

## Driving it with omacast-verify

Preconditions:

- The baseline from the README holds.
- For the hotkey entry, `hypruse binds | grep -i omacast` lists the binding.

- **CLI show.** Run `omarchy-shell omacast show`, then `hypruse wait_for layer_open --match omacast --timeout 3`. The wait prints `openlayer namespace=omacast` (or `already:`), and `omarchy-shell omacast isOpen` prints `true`.
- **CLI hide.** Run `$V hide`. It prints `hidden`, and `hyprctl layers -j | grep -c '"omacast"'` prints `0`.
- **Toggle.** Run `omarchy-shell omacast toggle` twice. The first prints `shown` and the second `hidden`.
- **Hotkey.** Run `hypruse use_bind ALT+SPACE`, then `hypruse wait_for layer_open --match omacast`. The layer opens. If `binds` has no such bind, report this entry point as unreachable.
- **Escape, default behaviour.** Run `$V open`, `$V type abc`, `$V key escape`. Take a shot: the query is empty and the launcher is still open. Then `$V key escape`, and `omarchy-shell omacast isOpen` prints `false`.
- **Latency.** Run `tests/smoke.sh`. It shows and hides 5 times and passes with `worst toggle N ms` where N is under 100.

## Gotchas

- `$V open` presses Shift+Esc to reach root. To prove `window-pop-to-root` itself, use `omarchy-shell shell summon typecraft.omacast '{"query":""}'` instead, so the harness doesn't do the reset for you.
- The footer shows "Loading…" for about 3 s after each open while `OmarchyMenuSource.refresh()` reruns the Omarchy menu guard scripts (`Backend.qml`, `window.visibilityChanged`). Don't treat that as a hang.
- `tests/smoke.sh` subscribes to Hyprland's event socket and kills its own `socat` afterwards. Don't drive keys while it runs.
- Synthetic keys never trigger compositor binds; only `hypruse use_bind` does.
