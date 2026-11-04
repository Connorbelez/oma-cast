# Action panel

Ctrl+K opens a filterable list of the selected row's actions, each with its shortcut. Choosing one runs it. Favourites added here appear at the top of the empty root and persist in `db/settings.json`.

## Sub-features

- `actions-open` Ctrl+K (or Alt+K with `vim-motions` bindings) opens the panel over the list.
- `actions-filter` typing filters actions, and ↑↓ moves between them.
- `actions-run` ↵ runs the highlighted action. Esc or Ctrl+K closes the panel.
- `actions-favorite` Add to Favorites (Ctrl+Shift+F) pins a row to the Favorites section. The same shortcut removes it.
- `actions-shortcut-hints` the footer shows the first action and `Actions Ctrl K`.

## How to get to it (user POV)

- Select any row and press Ctrl+K.
- Use a row action's shortcut directly without opening the panel (Ctrl+Shift+F, Ctrl+Shift+C).

## Driving it with omacast-verify

Preconditions:

- The baseline from the README holds.
- `$V call settings.getAllCommandSettings` shows no favourite for `builtin:calculator-history`.

- **Open.** Run `$V open`, `$V type "calculator history"`, wait 0.3 s, `$V key ctrl+k`, then `$V shot actions-open`. A panel lists `Open Command` (↵), `Add to Favorites` (Ctrl Shift F), `Set Alias`, `Reset Ranking` and `Disable Command` (Alt Shift D), with a `Search for actions…` field at the bottom.
- **Filter.** Run `$V type fav`, then `$V shot actions-filter`. Only `Add to Favorites` remains, and the filter field shows `fav`.
- **Favourite.** Run `$V key enter`. The panel closes, the footer toast reads `Added to Favorites`, and the row gains a ★. `$V call settings.getAllCommandSettings` prints `{"builtin:calculator-history":{"favoriteOrder":0}}`.
- **Favourites section.** Run `$V open`, then `$V shot favorites`. A Favorites section at the top lists `Calculator History` with a ★, and it's selected.
- **Close.** Run `$V key ctrl+k` twice. The panel opens and closes, and the list is unchanged.
- **Restore.** With the favourite selected, run `$V key ctrl+shift+f`. The toast reads `Removed from Favorites`, the row moves to Suggestions, and `settings.getAllCommandSettings` prints `{}`.

## Gotchas

- Hide clears the toast (since P7-1 on 2026-11-04), so assert it right after the action and before any hide.
- While a search is pending, Ctrl+K shows an empty panel by design (`actionsForSelected` returns `[]`). Wait 0.3 s after typing.
- With `navigationBindings` set to `vim-motions`, the panel is on Alt+K. Check with `$V call settings.getGeneralSettings`.
- Disable Command (Alt+Shift+D) hides the command, and there's no settings window to bring it back. Undo it right away with Ctrl+T → Undo.
