# Dynamic Taskbar Width on Maximized Windows

A KWin script for KDE Plasma 6: the floating panel grows to the full screen
width while a window is maximized, and returns to its resting width when the
window is restored. The icons keep their absolute position instead of sliding
to the screen edges.

**Languages:** English, German. The script and its settings page follow the
system language.

## Requirements

- KDE Plasma 6 (tested with 6.8.1 on Wayland, one 3440 × 1440 screen)
- A floating panel in **fit content** mode (`panelLengthMode=1`). That is the
  mode where the panel is exactly as wide as its content, which is what makes
  the two spacer widgets widen it instead of moving its content. The script
  reads the mode at runtime and never writes it; `tools/install.sh` reports the
  mode and only changes it with `--set-mode fit`
- Two spacer widgets in the panel (`org.kde.plasma.panelspacer`), one at each
  end. `tools/install.sh` adds them; they are invisible and 1 px wide while the
  panel is at rest
- `qdbus6`, `kpackagetool6`, `kwriteconfig6`, `python3` (all shipped with Plasma
  or a normal desktop install)

In **custom** mode the clamp carries the width, so the panel grows there too,
but the icons travel with the edge (measured 239 px, see the limits below). In
**fill** mode the panel is screen-wide already; the script writes one line to
the journal and stays out of the way.

## What the script does per panel length mode

The mode is read from the running plasmashell (`panels()[i].lengthMode`).
`panelLengthMode` in `plasmashellrc` belongs to the user and is never written by
the script.

| Mode | Panel width | What the script does |
|---|---|---|
| `fit` (fit content) | content width + floating paddings | animates both spacer widgets to `(screen − panel) / 2`, the panel glides around them, the icons stay |
| `custom` | content width + paddings, clamped to `[minimumLength, maximumLength]` | pins the clamp to the target while expanded and restores the old values on the way back; the panel grows, the icons move with it |
| `fill` | always the screen width | nothing, one journal line explaining why |

## Installation

```bash
./tools/install.sh                     # install or upgrade
./tools/install.sh --check             # report the state, change nothing
./tools/install.sh --set-mode fit      # switch the panel to fit content (only on request)
./tools/install.sh --remove-spacers    # drop the two spacer widgets again
```

The script installs the KWin script package, adds the two spacer widgets to the
panel (width 0, one at each end), measures the current panel width, writes it as
the resting length, enables the script in `kwinrc` and reloads it. An already
configured resting length is kept, and the panel length mode is only changed
when you pass `--set-mode`.

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
| Resting length (px) | Length the panel returns to in the fallback path. `-1` = passive, no change | -1 |
| Panel index | Position of the panel in `panels()`, `0` for a single panel | 0 |
| Keep the icons in place while the panel grows | The spacers widen instead of the content moving to the screen edges. Needs the two spacer widgets and fit content mode | off |
| Only count windows on the panel's screen | Ignore windows on other screens | on |
| Only count windows on the current desktop | Ignore windows on other desktops | on |
| Also expand for fullscreen windows | Fullscreen windows widen the panel too | off |

## How the icon pinning works

The script reads the panel width from the dock window (in KWin the dock window
*is* the visible panel; the value reported as `panels()[i].length` is 16 px
smaller because of the floating paddings). It works out
`(target − panel width) / 2` and writes that as the width of both spacer
widgets, where `target` is the screen width minus 6 pixels: at exactly the
screen width the layout is at its limit and Plasma starts squeezing the two
spacers unevenly, which moves the icons by tens of pixels. The gap disappears
under the floating edge of the panel.

Because the panel is only as wide as its content in fit content mode, adding
`n` pixels on both ends widens it by `2n`, and the left edge moves left by
exactly the amount the left spacer adds, so every widget keeps its absolute
position.

In custom mode the same arithmetic does not apply: the clamp decides the width
instead, so the script pins `minimumLength` and `maximumLength` to the target
for the duration of the expansion and restores the previous pair afterwards.
The panel then grows, but the row is laid out over the whole panel and the
icons move with it. Both values are written by the script, so plasmashell
persists them in `plasmashellrc`; if the shell is killed while a window is
maximized, the pinned clamp stays in the file until the next cycle.

### One layout step, no animation

The spacer width is written once, Plasma re-lays out the panel once, and the
panel reaches its target width in a single step. Measured with the dock
window sampled every 20 ms: exactly one width change, 1396 px to 3432 px.

An animated version was built and removed again: a `QTimer` stepped the
spacer width over 520 ms with an ease-out curve. Plasma needs about 55 ms per
layout round, so that transition landed in nine visible jumps of 250 to
300 px each, which looked worse than the single step. (KWin's scripting
engine has no `setTimeout`, but it does expose `QTimer`, so the approach is
possible, just not better here.)

### Measured cycle

Measured on a 3440 px screen (Plasma 6.8.1, nine widgets including both
spacers, one test window open):

| State | Panel (dock window) | Spacers | Kickoff | Task manager | Tray | Clock |
|---|---|---|---|---|---|---|
| window open, not maximized | 1396 px @ x=1022 | 1 px | 1041 | 1097 | 2066 | 2367 |
| maximized | 3432 px @ x=4 | 1019 px | 1041 | 1097 | 2066 | 2367 |
| restored | 1396 px @ x=1022 | 1 px | 1041 | 1097 | 2066 | 2367 |

(absolute x in pixels, measured with `applet.geometry` and the dock's
`frameGeometry`; the wiggle was 0 px for every visible widget, both when
expanding and when collapsing)

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
- The script writes no configuration: not the panel length mode, not its
  minimum or maximum length.

## Limitations

- **In `custom` mode the icons do not stay.** The clamp dictates the width, so
  the panel does grow, but the spacers cannot hold the content: Plasma lays the
  applet row out over the whole panel and it travels with the edge. Measured
  with a 2956 px panel that has to reach 3434 px: every visible widget moved by
  `(3434 − 2956) / 2 = 239 px`, and came back exactly. A spacer trick that held
  them within 1 px in a manual run did not reproduce in a real maximize cycle,
  so it is not built in. Use `fit content` if the icons have to stay put.
- **Tiling** (dragging a window to the edge, KWin 6 tiling) is not evaluated.
  Only real maximization counts.
- **The panel length is a result, not a setting.** In Plasma 6.8
  `panel.length` is bound to the content width (`Panel.qml`), so writing it does
  not stick; the panel width follows its content. That is why the spacers are
  the mechanism and why `restLength` only matters for the fallback path.
- **The resting width follows the task list.** In a floating, centred panel
  Plasma recomputes the width when tasks appear or disappear: measured 1316 px
  with no extra task and 1396 px with one. The script measures the width at the
  moment it expands, so it grows from whatever the panel happens to be.
- **One panel.** With several panels the widest dock is taken as the panel, and
  `panels()[panelIndex]` is the one that gets changed.

## Layout

```
package/
├── metadata.json              KPackage metadata, X-KDE-ConfigModule, translations
├── contents/
│   ├── code/main.js           configuration, sensor, spacer animation
│   ├── config/main.xml        KConfigXT definition of the settings
│   ├── ui/config.ui           settings page (Qt Designer XML, kcfg_ object names)
│   └── locale/de/LC_MESSAGES/ German translation of the settings page
po/de.po                       translation source
tools/install.sh               installation, spacer widgets, mode check, measurement
tools/panel_spacers.py         adds/removes the two spacer widgets in appletsrc
```

## License

MIT, see `LICENSE`.
