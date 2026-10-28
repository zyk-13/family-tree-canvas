# Family Tree Canvas

English · [简体中文](README.zh-CN.md)

Lay out a family tree on a canvas the way you'd sketch one on paper — not a generated diagram, but a board you arrange by hand.

Cards snap to generation rows, so you drag people where you want them sideways and the tree stays tidy vertically. One shared people library feeds several layouts, and every person is a note in your vault.

![Family Tree Canvas](docs/screenshot.png)

## Why another family tree plugin

The directory already has a few genealogy plugins. They read relationships from note properties and draw a graph for you. This one goes the other way: **you** decide the arrangement, and the plugin keeps the bookkeeping.

That matters when a family is messy — remarriage, adoption, someone raised by grandparents, a branch you only know two generations of. Auto-layout has to give up somewhere; a canvas doesn't.

## Features

- **One people library, many layouts.** The same 36 people can appear in a "whole family" layout, a "my household" layout, and a "grandpa's branch" layout. Editing a name or a birth date in one place updates all of them, and each person keeps a single note.
- **Snap to rows.** Drag a card sideways freely; drop it and it lands in a generation row. Rows are cleaned up when you compact.
- **Compact and centre.** A tidy-tree pass: children line up under their parents, the whole tree tightens, parents sit centred over their children. Repeat it — it's idempotent.
- **Swap a couple.** One click flips a husband and wife left/right, and the whole subtree follows.
- **Kinship calculator.** Pick two people and it names the relationship in Chinese (称呼) — 公公, 大姨子, 堂侄女 — and shows the chain it walked. Includes relatives up to 8 steps away, with a searchable person picker.
- **Themes.** Six presets plus full customisation: male / female / unspecified card colours, card text, the deceased's fill and border, parent–child and spouse line colours, and line width. Hover and selection borders are derived automatically so they stay visible on light cards.
- **Export to Markdown.** Turn a layout into a readable note: generations as sections, marriages, siblings, and links to each person's note.
- **Backups.** One click writes a timestamped JSON with the people library *and* every layout, to a folder you choose. Restore from a list; a safety copy of the current state is taken first.
- **English and 简体中文.** Switch in settings; the whole interface follows.

## Install

Once published, search for **Family Tree Canvas** in *Settings → Community plugins → Browse*.

Until then, install manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/zyk-13/family-tree-canvas/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/family-tree-canvas/`.
3. Reload Obsidian and enable **Family Tree Canvas** in *Settings → Community plugins*.

## Usage

1. Run **Open family tree** from the command palette, or click the network icon in the ribbon.
2. **Add people** — the person icon adds from the people library; a new card is created if the name isn't there yet.
3. **Arrange** — drag cards. Drag the small handle between a couple to change who stands on the left.
4. **Right-click** a card for edit, delete, add spouse, add child, swap, and open-note actions.
5. **Compact and centre** when the layout drifts; **undo** puts it back.

## Where the data lives

| File | Contents |
| --- | --- |
| `.obsidian/plugins/family-tree-canvas/graph.json` | The people library and every layout |
| `.obsidian/plugins/family-tree-canvas/data.json` | Plugin settings |
| The backup folder you choose (default `family/家谱备份`) | Timestamped JSON backups |

**Uninstalling the plugin deletes its folder, including `graph.json`.** Export a backup first — that's what the download icon in the toolbar is for.

## Privacy

No network requests, no telemetry, no accounts. Everything stays in your vault. The plugin works fully offline.

## Development

```bash
npm install
npm run build   # bundles src/ into main.js
npm run dev     # rebuild on change
```

Source lives in `src/`:

| File | Role |
| --- | --- |
| `src/main.js` | Plugin entry: commands, backup/restore, settings tab |
| `src/view.js` | The canvas view: pan, zoom, drag, snapping, toolbar |
| `src/layout.js` | Layout computation, connector geometry, tidy-tree compaction |
| `src/model.js` | Data model v4, people library, layouts, persistence |
| `src/modals.js` | Person editor, layouts manager, kinship, backup, theme dialogs |
| `src/kinship.js` | Relationship path search and Chinese kinship naming |
| `src/theme.js` | Theme presets, colour derivation, CSS variable output |
| `src/i18n.js` | English / Chinese strings |
| `src/backup.js` | Backup envelope format, parsing, formatting |

## License

MIT — see [LICENSE](LICENSE).
