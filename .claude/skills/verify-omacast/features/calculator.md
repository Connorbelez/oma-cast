# Calculator

A math, unit, currency, date or time-zone query shows a two-pane answer card in a Calculator section above Results. ↵ copies the answer, shows a "Copied to Clipboard" HUD, closes the launcher and saves the calculation to Calculator History, a searchable pushed view.

## Sub-features

- `calc-card` shows question → answer, with a caption under each (for example `Expression` / `Twenty-two`).
- `calc-copy` ↵ copies the answer, shows the OSD HUD and closes the launcher.
- `calc-paste` Ctrl+↵ pastes into the previous window.
- `calc-copy-qa` Ctrl+Shift+C copies `question = answer`.
- `calc-history` saves every copy or paste to `db/calculator.json`. The Calculator History view lists, searches and deletes entries (Ctrl+D one, Ctrl+Shift+D all, after an alert).
- `calc-no-row` a bare number, word or quantity (`42`, `firefox`, `5 kg`) produces no calculator row.

## How to get to it (user POV)

- Type an expression in the launcher at root.
- Open "Calculator History" from root search, or run `omacast run builtin:calculator-history`.

## Driving it with omacast-verify

Preconditions:

- The baseline from the README holds.
- Note the history count first: `$V call calculator.historyGetAll | jq '.data | length'`.

- **Card.** Run `$V open`, `$V type "17*3"`, wait 0.3 s, then `$V shot calc-card`. The Calculator section shows `17*3` → `51`, and the footer's primary action reads `Copy Answer`.
- **Copy.** Run `$V key enter`, then `$V shot calc-hud` within 1 s. The OSD shows `Copied to Clipboard`. `omarchy-shell omacast isOpen` prints `false`, and `wl-paste -n` prints `51`.
- **History store.** Run `$V call calculator.historyGetAll | jq -c '.data[-1]'`. The last entry has `"query":"17*3","result":"51"`, and the count went up by one.
- **History view.** Run `$V run builtin:calculator-history`, then `$V shot calc-history`. The header placeholder reads `Search calculations…`, and a `Today` section lists `51 17*3`.
- **No row.** Run `$V open`, `$V type 42`, wait 0.3 s. `$V titles 42` has no `## Calculator` section.
- **Restore.** Delete the entry you added: `$V call calculator.historyDelete '{"id":"<id from the store>"}'`. The count is back to where it started.

## Gotchas

- ↵ overwrites the user's clipboard, and Omarchy's clipboard history records it. Copy only harmless test values, and tell the user.
- Ctrl+↵ pastes into whatever window was focused before the launcher, usually the agent's terminal. Prove `calc-paste` only after focusing a scratch window that the run opened itself.
- Currency answers need the ECB rates fetched on first use (`exchange rates updated` in `$V log`). Offline, currency rows don't appear.
- Captions spell the answer out in words. Assert the answer pane, not the caption.
