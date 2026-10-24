# Dynamic Taskbar Width on Maximized Windows

A KWin script for KDE Plasma 6: the floating panel grows to the full screen
width while a window is maximized, and returns to its resting width when the
window is restored. The icons keep their absolute position instead of sliding
to the screen edges.

**Languages:** English, German. The script and its settings page follow the
system language.

## Requirements

- KDE Plasma 6 (tested with 6.8.1 on Wayland, one 3440 × 1440 screen)
- A floating panel in **fit content** or **custom length** mode. Both are modes
  where the panel is not screen-wide by itself, which is what makes the two
  spacer widgets widen it instead of moving its content. `tools/install.sh`
  reads the mode, reports what it means and never changes it
- Two spacer widgets in the panel (`org.kde.plasma.panelspacer`), one at each
  end. `tools/install.sh` adds them; they are invisible and 1 px wide while the
  panel is at rest
- `qdbus6`, `kpackagetool6`, `kwriteconfig6`, `python3` (all shipped with Plasma
  or a normal desktop install)

In **fill** mode the panel is always as wide as the screen. There is nothing to
widen, so the script stays out of the way and writes one line to the journal
saying exactly that.

## What the script does per panel length mode

The mode is read from the running plasmashell (`panels()[i].lengthMode`). The
script never writes it: `panelLengthMode` in `plasmashellrc` belongs to the
user.

| Mode | Panel width | What the script does |
|---|---|---|
| `fit` (fit content) | content width + floating paddings | sets both spacer widgets to `(screen − panel) / 2`, the panel grows around them |
| `custom` | content width + paddings, clamped to `[minimumLength, maximumLength]` | widens the clamp so the target width is allowed, then sets the spacers; on the way back it restores the old clamps and the old length. If the clamp is already wider than the content (a panel with a fixed length, `min == max`), it pins the clamp to the target instead, see the limits below |
| `fill` | always the screen width | nothing, one journal line explaining why |

Neither mode nor clamp is touched on startup: the script only acts when a
window is maximized, and it puts the clamp back when the last one is restored.

## Installation

```bash
./tools/install.sh                     # install or upgrade
./tools/install.sh --check             # report the state, change nothing
./tools/install.sh --set-mode fit      # switch the panel to fit content (only on request)
./tools/install.sh --set-mode custom   # switch it to custom length
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
| Resting length (px) | Length the panel returns to. `-1` = passive, no change | -1 |
| Panel index | Position of the panel in `panels()`, `0` for a single panel | 0 |
| Keep the icons in place while the panel grows | The spacers widen instead of the content moving to the screen edges. Needs the two spacer widgets | off |
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

Because the panel is only as wide as its content in both supported modes,
adding `n` pixels on both ends widens it by `2n`, and the left edge moves left
by exactly the amount the left spacer adds, so every widget keeps its absolute
position.

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

The same cycle in **custom** mode, with the clamp deliberately narrow
(`minimumLength=600`, `maximumLength=2000` so the target would not fit):

| State | Panel | Clamp | Spacers | Kickoff | Task manager | Tray | Clock |
|---|---|---|---|---|---|---|---|
| window open, not maximized | 1396 px @ x=1022 | 600..2000 | 1 px | 1041 | 1097 | 2066 | 2367 |
| maximized | 3432 px @ x=4 | 600..3434 | 1019 px | 1041 | 1097 | 2066 | 2367 |
| restored | 1396 px @ x=1022 | 600..2000 | 1 px | 1041 | 1097 | 2066 | 2367 |

If the spacers are missing in **fit** mode the script falls back to simply
setting the panel length, which is what it did before version 0.4.0: the panel
grows, the icons move to the edges. In **custom** mode the fallback pins the
length clamp to the target instead, because a plain length change does not hold
there.

## Security

- Reads only its own configuration through `readConfig`.
- Talks only to `org.kde.plasmashell` (`/PlasmaShell`, `evaluateScript`).
- No network, no file access, no process execution, no background service, no
  secrets, no telemetry.
- Every value that reaches a generated script is a checked integer: length
  32 to 20000, panel index 0 to 16, spacer width 0 to 20000, clamp 32 to 20000.
  Window titles or class names never reach a payload, so string injection is
  ruled out.

## Limitations

- **Tiling** (dragging a window to the edge, KWin 6 tiling) is not evaluated.
  Only real maximization counts.
- **`fill` mode does nothing.** The panel is screen-wide there by definition.
  The script says so in the journal once and leaves the panel alone.
- **The panel length is a result, not a setting.** In Plasma 6.8
  `panel.length` is bound to the content width (`Panel.qml`), so writing it does
  not stick; the panel width follows its content, clamped by the mode. That is
  why the spacers are the mechanism and why `restLength` only matters for the
  fallback path.
- **In custom mode the script writes the clamp.** `minimumLength` and
  `maximumLength` are persisted by plasmashell in `plasmashellrc`; the script
  widens the clamp while expanded and restores the previous values afterwards.
  If plasmashell is killed while a window is maximized, the widened clamp stays
  in the file until the next expansion/collapse cycle or a manual correction.
- **The resting width follows the task list.** In a floating, centred panel
  Plasma recomputes the width when tasks appear or disappear: measured 1316 px
  with no extra task and 1396 px with one. The script measures the width at the
  moment it expands and returns to that value, not to a number from the
  settings.
- **A panel with a fixed length cannot pin the icons.** With `minimumLength ==
  maximumLength` the clamp decides the width, not the content, so the spacer
  widgets are useless there. Plasma then lays the applet row out either as a
  block that caps at 2944 px and is centred, or stretched over the whole
  panel, and which of the two it does was not stable between runs (observed
  with the same panel and the same code, once capped at 2944 px, once filled).
  In both cases the icons move together with the edge: measured with a
  2956 px panel that has to reach 3434 px, they move by `(3434 − 2956) / 2 =
  239 px`. The script pins the clamp to the target so the panel does grow and
  the window gets its full width, but the icons go with it. A spacer of the
  floating padding (8 px) held them within 1 px in a manual run and did not
  hold them in a real maximize cycle, so it is not built in. Use a clamp range
  (for example `min = 600`) if the icons have to stay put: that path is
  measured at 0 px.
- **One panel.** With several panels the widest dock is taken as the panel, and
  `panels()[panelIndex]` is the one that gets changed.

## Layout

```
package/
├── metadata.json              KPackage metadata, X-KDE-ConfigModule, translations
├── contents/
│   ├── code/main.js           configuration, sensor, D-Bus payloads per mode
│   ├── config/main.xml        KConfigXT definition of the settings
│   ├── ui/config.ui           settings page (Qt Designer XML, kcfg_ object names)
│   └── locale/de/LC_MESSAGES/ German translation of the settings page
po/de.po                       translation source
tools/install.sh               installation, spacer widgets, mode check, measurement
tools/panel_spacers.py         adds/removes the two spacer widgets in appletsrc
```

## License

MIT, see `LICENSE`.
