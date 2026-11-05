# Root search

Typing in the launcher at root ranks applications, every Omarchy menu action and the built-in commands with the ported Raycast ranker, and lists web-search fallbacks under `Use "<q>" with…`. An empty root shows Favorites, Suggestions, Commands and Applications.

## Sub-features

- `search-empty-root` shows the Favorites (if any), Suggestions (if any frecency), Commands and Applications sections.
- `search-omarchy` finds Omarchy menu items, with breadcrumbs (`Nightlight Trigger › Toggle`).
- `search-apps` finds desktop applications.
- `search-typo` matches a mistyped query (`lcok` → Lock).
- `search-fallback` shows Search Google and Search DuckDuckGo with the query.
- `search-history` brings back recent queries with ↑ on an empty root.
- `search-filter` narrows root to Applications or Commands with the Ctrl+P dropdown.
- `search-files` adds a Files section after Results for file names of 3 or more characters, and the Files section alone for a `~/` or `/` path; `file-search.md` (`files-root`) drives it.

## How to get to it (user POV)

- Open the launcher and type.
- Press Ctrl+P at root to pick All, Applications or Commands.
- Press ↑ on an empty root for recent queries.

## Driving it with omacast-verify

Preconditions:

- The baseline from the README holds.
- `$V doctor` reports more than 300 candidates.

- **Empty root.** Run `$V open`, then `$V shot empty-root`. The Commands and Applications section headers are visible. `$V titles ""` lists `## Commands` and `## Applications`.
- **Omarchy item.** Run `$V type nightlight`, wait 0.3 s, then `$V shot nightlight`. The first row reads `Nightlight` with `Trigger › Toggle` and the tag `Command`. Below it, `Use "nightlight" with…` shows Search Google and Search DuckDuckGo. Don't press ↵ here.
- **Typo.** Needs the flea helper (`$V doctor` prints `flea-search helper built`). Run `$V key ctrl+u`, then `$V type lcok`. The first Results row is `Lock`. With the JS fallback, `lcok` shows only the fallback section. Report `search-typo` as skipped, with that reason.
- **No match.** Run `$V key ctrl+u`, then `$V type zzzz-no-match`. Only the fallback section is shown.
- **Filter.** Run `$V key ctrl+u`, `$V key ctrl+p`, `$V shot filter-menu`. A dropdown lists `✓ All`, `Applications` and `Commands` over a `Filter…` field. `$V key escape` closes it.
- **History.** After a launch from root, such as the calculator copy in calculator.md, run `$V open`, `$V key up`, `$V shot history`. The last query fills the field.

## Gotchas

- `Firefox` at root is `Install › Browser › Firefox`: ↵ would install it. Prove app launching on an app the user agrees to open.
- Without `bin/omacast-search`, matching uses the JS fallback, so typo results can differ from the flea helper. Say which one answered (`$V doctor` reports it).
- `$V titles` runs the same backend search with no keyboard involved. It confirms ranking, not the screen.
- A launch from root clears the query; a hide does not.
