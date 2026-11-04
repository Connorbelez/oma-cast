# Navigation

Rows tagged `Menu` (Omarchy submenus, Calculator History, the alias editor) push a view with its own search field and a back arrow. The user goes back with Esc, Ctrl+[, Backspace on an empty query or the header arrow, and Shift+Esc returns to root from any depth. Returning restores the earlier query and selection.

## Sub-features

- `nav-push` ↵ on a `Menu` row pushes the submenu with an empty query and a `Search <Menu>…` placeholder.
- `nav-search-within` typing in a submenu filters only that submenu.
- `nav-back` Backspace on an empty query, Esc, Ctrl+[ or the arrow pops one level and restores the earlier query.
- `nav-root` Shift+Esc pops to root from any depth.
- `nav-omarchy-menu` "Omarchy Menu" (`builtin:omarchy-menu`) hands off to the original Omarchy menu.

## How to get to it (user POV)

- Search for a submenu such as `trigger` and press ↵.
- Run `omacast run omarchy:trigger`.

## Driving it with omacast-verify

Preconditions:

- The baseline from the README holds.

- **Push.** Run `$V open`, `$V type trigger`, wait 0.3 s, `$V key enter`, then `$V shot nav-pushed`. The header shows a back arrow and the placeholder `Search Trigger…`. The rows include `Emoji`, `Reminder`, `Capture` and `Transcode`.
- **Search within.** Run `$V type cap`. Only Trigger's children match, starting with `Capture`.
- **Back.** Run `$V key ctrl+u`, then `$V key backspace`, then `$V shot nav-back`. Root is back with the query `trigger` and `Trigger Omarchy` selected.
- **Two levels and root.** Press ↵ on `Trigger` again, then `$V type capture`, wait 0.3 s, and `$V key enter`. That pushes Capture. Then `$V key shift+escape` and `$V shot nav-root`: root with an empty query.
- **CLI entry.** Run `$V run omarchy:trigger`. The output contains `"push"`, and a shot shows `Search Trigger…`.

## Gotchas

- The pushed view survives hide/show for 90 s. Opening any other way than `$V open` can land you inside a stale submenu, which looks like "No results" for a root query.
- Children of `Trigger › Capture` start screenshots and screen recordings when chosen. Stop at the push.
- `builtin:omarchy-menu` closes omacast and opens Omarchy's own menu (a different layer). Close it with `hypruse keyboard key escape` once `hypruse wait_for layer_open` confirms it is up.
