# omacast verification map

This directory is the maintained source for verifying omacast's user-facing behaviour in the live Omarchy shell. Read the index before driving the launcher, then use the matching feature file as the recipe. `V` below is `.agents/skills/verify-omacast/scripts/omacast-verify`.

## Baseline preconditions

- A Hyprland session with `omarchy-shell` running, and `hypruse doctor` green.
- `$V launch` has finished for this run, and `$V doctor` passes with this checkout's commit.
- Every journey starts with `$V open`, which shows the launcher at root with an empty query and no popup.
- No other verification run is active, and the user is not typing into the launcher.

## Driving conventions

- Prefer row ids (`builtin:calculator-history`, `omarchy:trigger`) and titles from `$V titles` over screen positions.
- Wait about 0.3 s after `type` before `enter`. ↵ does nothing while the search for the latest keystroke is still pending, and a 0.3 s wait clears that.
- Press ↵ only on rows these files call safe. Root search also lists power actions, installers and toggles.
- Restore every store you change (favourites, aliases, disabled commands, calculator history) before cleanup.

## Proof and skip reporting

- UI proof is a screenshot before and after the action, cropped to the launcher before you share it.
- Side-effect proof is a second, read-only view: `$V call …`, `wl-paste -n` for text this run copied, or the OSD in a screenshot.
- Record the feature file and the entry point with every artifact.
- Report an unreachable entry point (for example, no Alt+Space binding) with the command you tried and the precondition that was missing. Never count it as verified through another entry point.

## Feature entry contract

Each feature file has an H1 title and one paragraph, then exactly four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with omacast-verify`, `Gotchas`.

## Features

- [Launcher window](./window.md): show, hide, toggle, Escape behaviour, pop to root, latency.
- [Root search](./root-search.md): sections, apps, Omarchy menu items, fallbacks, search history.
- [Calculator](./calculator.md): the inline answer card, copy with HUD, Calculator History.
- [Action panel](./action-panel.md): Ctrl+K, filtering, favourites and their persistence.
- [Navigation](./navigation.md): pushed Omarchy submenus, back, Shift+Esc to root.
- [File search](./file-search.md): the file list, large untouched subtrees and their toast, the `files.*` RPCs, doctor lines (P7-1 and P7-2; the preview pane, the root Files section and content results land with P7-3 to P7-5).
