# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.6.x | yes |
| older | no |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting: open the **Security** tab of
this repository and choose **Report a vulnerability**. That opens a private
discussion with the maintainer; the report, the discussion and the fix stay
private until an advisory is published.

Please do not open a public issue for a security problem.

## What the script touches

Dynamic Taskbar Width is a KWin script plus two helper scripts. Knowing the
surface makes triage easier:

- `package/contents/code/main.js` runs inside KWin. It reads its own
  configuration from `kwinrc` and calls `org.kde.plasmashell` over D-Bus with
  generated, integer-only payloads. It does not read files, start processes,
  open sockets or touch other windows' contents.
- `tools/install.sh` writes to `~/.local/share/kwin/scripts/`,
  `~/.config/plasma-org.kde.plasma.desktop-appletsrc` and `kwinrc`, and restarts
  plasmashell for the applet edit.
- `tools/panel_spacers.py` edits the applet configuration file and nothing else.

Reports about the payload generation (string injection into `evaluateScript`),
the applet configuration editing, or the installer's file handling are in scope.

## Out of scope

- Plasma, KWin or Qt behaving unexpectedly on its own.
- The panel length being a computed value rather than a setting; that is a
  Plasma design decision, documented in the README under Limitations.
