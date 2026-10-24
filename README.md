# Dynamic Taskbar Width on Maximized Windows

A KWin script for KDE Plasma 6: the floating panel grows to the full screen
width while a window is maximized, and returns to its resting length when the
window is restored. Optionally the panel grows *around* its content, so the
icons keep their position instead of sliding to the screen edges.

**Languages:** English, German. The script and its settings page follow the
system language.

## Requirements

- KDE Plasma 6 (tested with 6.8.1 on Wayland, one 3440 × 1440 screen)
- A floating, centred panel whose length follows its content
  ("fit content", `panelLengthMode=1` in `plasmashellrc`). `tools/install.sh`
  sets this if it is not set yet and prints how to revert it
- `qdbus6`, `kpackagetool6`, `kwriteconfig6`, `python3` (all shipped with Plasma
  or a normal desktop install)

The icon pinning needs the panel to be as wide as its content: that is what
makes two spacer widgets on both ends grow the panel instead of moving its
content. On a panel that fills the screen there is nothing to grow.

## Installation

```bash
./tools/install.sh            # install or upgrade
./tools/install.sh --check    # report the state, change nothing
./tools/install.sh --remove-spacers   # drop the two spacer widgets again
```

The script installs the KWin script package, adds two spacer widgets to the
panel (`org.kde.plasma.panelspacer`, width 0, one at each end), sets the panel
length mode to fit-content if needed, measures the current panel length and
writes it as the resting length, enables the script in `kwinrc` and reloads it.

The spacers have to be written into
`~/.config/plasma-org.kde.plasma.desktop-appletsrc` while plasmashell is
stopped, because Plasma only lays out widgets that were in that file when it
started. Widgets added at runtime get no geometry at all. `tools/install.sh`
does the stop, the edit and the start, and `tools/panel_spacers.py` does the
file work if you want to look at it.

Former package ids (`panel-full-width`, `panelweite`) are migrated: their
resting length is taken over, their package and configuration group are
removed.

## Settings

System Settings → Window Management → KWin Scripts → "Dynamic Taskbar Width on
Maximized Windows" → gear icon (or `kcmshell6 kcm_kwin_scripts`). The page is a
Qt Designer file (`contents/ui/config.ui`, XML with `kcfg_` object names), not
QML; the keys live in `contents/config/main.xml` and are read with `readConfig`
from `[Script-dynamic-taskbar-width]` in `kwinrc`.

| Setting | Meaning | Default |
|---|---|---|
| Enabled | Script on or off | on |
| Resting length (px) | Length the panel returns to. `-1` = passive, no change | -1 |
| Panel index | Position of the panel in `panels()`, `0` for a single panel | 0 |
| Keep the icons in place while the panel grows | Empty edges grow instead of the content moving to the screen edges. Needs the two spacer widgets | off |
| Only count windows on the panel's screen | Ignore windows on other screens | on |
| Only count windows on the current desktop | Ignore windows on other desktops | on |
| Also expand for fullscreen windows | Fullscreen windows widen the panel too | off |

## How the icon pinning works

With *Keep the icons in place* enabled the script does not set the panel length
at all. It reads the current panel width from the dock window, works out
`(screen width − panel width) / 2` and writes that value as the width of both
spacer widgets. Because the panel is only as wide as its content, adding
`n` pixels on both ends widens it by `2n`, and the left edge moves left by
exactly the amount the left spacer adds, so every widget keeps its absolute
position.

Measured on a 3440 px screen:

| State | Panel | Boots at | Kickoff | Task manager | Tray | Clock |
|---|---|---|---|---|---|---|
| window open, not maximized | 1396 px @ x=1022 | 1041 | 1097 | 2066 | 2304 |
| maximized | 3438 px @ x=1 | 1041 | 1097 | 2066 | 2304 |
| restored | 1396 px @ x=1022 | 1041 | 1097 | 2066 | 2304 |

(absolute x in pixels)

If the spacers are missing the script falls back to simply setting the panel
length, which is what it did before version 0.4.0: the panel grows, the icons
move to the edges.

## Security

- Reads only its own configuration through `readConfig`.
- Talks only to `org.kde.plasmashell` (`/PlasmaShell`, `evaluateScript`).
- No network, no file access, no process execution, no background service, no
  secrets, no telemetry.
- Every value that reaches a generated script is a checked integer: length
  32 to 20000, panel index 0 to 16, spacer width 0 to 20000. Window titles or
  class names never reach a payload, so string injection is ruled out.

## Limitations

- **Tiling** (dragging a window to the edge, KWin 6 tiling) is not evaluated.
  Only real maximization counts.
- **The resting length is a fixed number** for the classic path. With icon
  pinning the script measures the panel itself, so no value has to be kept up to
  date.
- **Persistence:** the length set through `evaluateScript` does not end up in
  `plasma-org.kde.plasma.desktop-appletsrc`, so a crash does not leave a wide
  panel behind. The spacer widths survive a restart, but the script normalizes
  them to 0 on start.
- **The length follows the content.** In a floating, centred panel Plasma
  recomputes the length when tasks appear or disappear: measured 1290 px with no
  task button and 1370 px with one. A length set through `evaluateScript` holds
  until the next such change.
- **One panel.** With several panels the widest dock is taken as the panel, and
  `panels()[panelIndex]` is the one that gets changed.

## Layout

```
package/
├── metadata.json              KPackage metadata, X-KDE-ConfigModule, translations
├── contents/
│   ├── code/main.js           configuration, sensor, two D-Bus payloads
│   ├── config/main.xml        KConfigXT definition of the settings
│   ├── ui/config.ui           settings page (Qt Designer XML, kcfg_ object names)
│   └── locale/de/LC_MESSAGES/ German translation of the settings page
po/de.po                       translation source
tools/install.sh               installation, spacer widgets, panel mode, measurement
tools/panel_spacers.py         adds/removes the two spacer widgets in appletsrc
```

## License

MIT, see `LICENSE`.
