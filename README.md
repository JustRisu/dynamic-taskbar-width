# Dynamic Taskbar Width on Maximized Windows

A KWin script for KDE Plasma 6: the floating panel grows to the full screen
width while a window is maximized, and returns to its resting length when the
window is restored.

**Languages:** English, German. The script and its settings page follow the
system language.

## Requirements

- KDE Plasma 6 (tested with 6.8.1 on Wayland)
- A plasma panel whose length can be set through `panels()[i].length`
  (the standard `org.kde.panel` containment)
- `qdbus6`, `kpackagetool6`, `kwriteconfig6` (shipped with Plasma)

## Installation

```bash
./tools/install.sh
```

The script installs the package, measures the current panel length through
evaluateScript, writes it as the resting length, enables the script in
`kwinrc` and reloads it.

Former package ids (`panel-full-width`, `panelweite`) are migrated: their
resting length is taken over, their package and configuration group are
removed.

Manual installation:

```bash
kpackagetool6 --type KWin/Script --install package
kwriteconfig6 --file kwinrc --group Script-dynamic-taskbar-width --key restLength 1316
kwriteconfig6 --file kwinrc --group Plugins --key dynamic-taskbar-widthEnabled true
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript dynamic-taskbar-width
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript \
  "$HOME/.local/share/kwin/scripts/dynamic-taskbar-width/contents/code/main.js" dynamic-taskbar-width
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start
```

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
| Only count windows on the panel's screen | Ignore windows on other screens | on |
| Only count windows on the current desktop | Ignore windows on other desktops | on |
| Also expand for fullscreen windows | Fullscreen windows widen the panel too | off |

## Security

- Reads only its own configuration through `readConfig`.
- Talks only to `org.kde.plasmashell` (`/PlasmaShell`, `evaluateScript`).
- No network, no file access, no process execution, no background service, no
  secrets, no telemetry.
- The value in the generated script is a checked integer (32 to 20000), the
  panel index is an integer from 0 to 16. Window titles or class names never
  reach the payload, so string injection is ruled out.
- Without a configured resting length the script stays passive. It can never
  widen a panel without a known way back.

## Limitations

- **Tiling** (dragging a window to the edge, KWin 6 tiling) is not evaluated.
  Only real maximization counts.
- **The resting length is a fixed number.** If the panel is changed by hand and
  kept that way, the value has to be adjusted in the settings.
- **Persistence:** the length set through `evaluateScript` does not end up in
  `plasma-org.kde.plasma.desktop-appletsrc` (checked with md5 before and after),
  so a crash does not leave a wide panel behind. The script still normalizes on
  startup.
- **The length follows the content.** In a floating, centred panel Plasma
  recomputes the length when tasks appear or disappear: measured 1290 px with
  no task button and 1370 px with one, both without the script touching the
  panel. A length set through `evaluateScript` holds until the next such
  change, then Plasma's own value is back. The resting length in the settings
  is therefore re-applied on the next start or maximise cycle, not pinned.
- **One panel.** With several panels the widest dock is taken as the panel, and
  `panels()[panelIndex]` is the one that gets changed.

## Layout

```
package/
├── metadata.json              KPackage metadata, X-KDE-ConfigModule, translations
├── contents/
│   ├── code/main.js           configuration, sensor, one D-Bus call
│   ├── config/main.xml        KConfigXT definition of the settings
│   ├── ui/config.ui           settings page (Qt Designer XML, kcfg_ object names)
│   └── locale/de/LC_MESSAGES/ German translation of the settings page
po/de.po                       translation source
tools/install.sh               installation plus first-time measurement
```

## License

MIT, see `LICENSE`.
