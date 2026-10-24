#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Installs Dynamic Taskbar Width: the KWin script, the two spacer applets the
# icon pinning needs, and the resting length.
#
# What it changes and why:
#  - the KWin script package under ~/.local/share/kwin/scripts/
#  - the two spacer applets in the panel (appletsrc), because Plasma only lays
#    out applets that were already in the file when it started
#  - [Script-dynamic-taskbar-width] restLength, measured once from the running
#    panel and never overwritten afterwards
#
# What it deliberately does NOT change: the panel length mode. The icon pinning
# needs fit content; the script reads the mode at runtime, stays passive in
# custom and fill and says so in the journal. Changing the mode is the user's
# decision, so it only happens with --set-mode.
#
#   ./install.sh                     install or upgrade
#   ./install.sh --check             report the state, change nothing
#   ./install.sh --set-mode fit      switch the panel to fit content
#   ./install.sh --set-mode custom   switch the panel to custom length
#   ./install.sh --remove-spacers    drop the two spacer applets again

set -euo pipefail

ID="dynamic-taskbar-width"
FORMER_IDS="panel-full-width panelweite"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$HERE/package"
SPACERS="$HERE/tools/panel_spacers.py"
SKRIPT="$HOME/.local/share/kwin/scripts/$ID/contents/code/main.js"
APPLETSRC="$HOME/.config/plasma-org.kde.plasma.desktop-appletsrc"
SHELLRC="$HOME/.config/plasmashellrc"

say() { printf '%s\n' "$*"; }

kwin() { qdbus6 org.kde.KWin "$@"; }

packages() { kpackagetool6 --type KWin/Script --list 2>/dev/null || true; }

# evaluateScript returns the print() output as the reply to the D-Bus call and
# qdbus6 writes it to stdout (measured 2026-10-24 with plasmashell 6.8.1).
plasma() {
    qdbus6 org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript "$1" 2>&1 || true
}

panel_id() {
    plasma 'print("DTWID " + panels()[0].id);' | sed -n 's/.*DTWID \([0-9]\{1,6\}\).*/\1/p' | tail -n1
}

measure_length() {
    local marker="DTW_MEASURE_$RANDOM$RANDOM"
    plasma "print('$marker ' + panels()[0].length);" \
        | sed -n "s/.*$marker \([0-9]\{1,6\}\).*/\1/p" | tail -n1
}

# The mode as the running shell sees it, which is what the script works with.
panel_mode() {
    plasma 'print("DTWMODE " + panels()[0].lengthMode);' \
        | sed -n 's/.*DTWMODE \([a-z]*\).*/\1/p' | tail -n1
}

panel_clamp() {
    plasma 'var p = panels()[0]; print("DTWCLAMP " + p.minimumLength + " " + p.maximumLength);' \
        | sed -n 's/.*DTWCLAMP \([0-9]*\) \([0-9]*\).*/\1..\2/p' | tail -n1
}

rest_length_of() {
    local group="$1"
    local raw
    raw="$(kreadconfig6 --file kwinrc --group "$group" --key restLength --default -1 2>/dev/null || echo -1)"
    case "$raw" in
        ''|*[!0-9-]*) printf '%s' -1 ;;
        *) printf '%s' "$raw" ;;
    esac
}

stop_plasma() {
    local pid
    pid="$(pgrep -x plasmashell | head -1 || true)"
    if [ -n "$pid" ]; then
        kill "$pid" 2>/dev/null || true
        local i
        for i in $(seq 1 20); do
            pgrep -x plasmashell >/dev/null || return 0
            sleep 1
        done
    fi
}

start_plasma() {
    # Plasma writes the appletsrc on shutdown, so it has to be stopped before
    # the file is edited and started again afterwards.
    (setsid plasmashell --replace >/dev/null 2>&1 &)
    local i
    for i in $(seq 1 30); do
        sleep 1
        if plasma 'print("DTWUP");' | grep -q DTWUP; then
            sleep 2
            return 0
        fi
    done
    return 1
}

spacer_geometry() {
    plasma 'var p=panels()[0]; var n=0; var w=[]; for (var i=0;i<p.widgets().length;i++){ var a=p.widgets()[i]; a.currentConfigGroup=["General"]; if (a.readConfig("dtwRole", "") !== "") { n++; w.push(a.geometry.width); } } print("DTWSPACERS " + n + " [" + w.join(",") + "]");' \
        | sed -n 's/.*DTWSPACERS \(.*\)$/\1/p' | tail -n1
}

# What the current mode means for the script, in one paragraph.
report_mode() {
    local mode="$1"
    local clamp="$2"
    case "$mode" in
        fit)
            say "Panel length mode: fit content - the panel is exactly as wide as its"
            say "  content, so the two spacers widen it and the icons keep their place."
            ;;
        custom)
            say "Panel length mode: custom (clamp ${clamp:-?}) - the clamp decides the"
            say "  width, not the content, so the spacer applets cannot hold the icons"
            say "  while the panel grows. The script stays passive here and says so in"
            say "  the journal. Switch to fit content to use the icon pinning:"
            say "  ./tools/install.sh --set-mode fit"
            ;;
        fill)
            say "Panel length mode: fill - the panel is always as wide as the screen."
            say "  There is nothing to widen, so the script does nothing and writes one"
            say "  line to the journal explaining that. To let the panel grow around its"
            say "  icons, switch it to 'fit content' or 'custom length' yourself:"
            say "  ./tools/install.sh --set-mode fit   (or: custom)"
            ;;
        *)
            say "Panel length mode: not readable (is plasmashell running?)."
            ;;
    esac
}

if [ "${1:-}" = "--set-mode" ]; then
    wanted="${2:-}"
    case "$wanted" in
        fit|custom) ;;
        *)
            say "Usage: ./tools/install.sh --set-mode fit|custom"
            say "  fit     the panel is exactly as wide as its content (panelLengthMode=1)"
            say "  custom  the panel follows its content within minimumLength..maximumLength (2)"
            say "  fill is the default Plasma behaviour and needs no setting from here."
            exit 2
            ;;
    esac
    pid="$(panel_id)"
    before="$(panel_mode)"
    if [ "$before" = "$wanted" ]; then
        say "Panel length mode is already '$wanted', nothing to do."
        exit 0
    fi
    if [ -n "$pid" ] && plasma "var p = panels()[0]; if (p) { p.lengthMode = '$wanted'; }" >/dev/null; then
        # setLengthMode() also writes panelLengthMode to plasmashellrc, so this
        # survives a restart of the shell.
        after="$(panel_mode)"
        if [ "$after" = "$wanted" ]; then
            say "Panel length mode changed from '${before:-unknown}' to '$wanted'."
            say "Revert with: ./tools/install.sh --set-mode ${before:-fit}"
            if [ "$wanted" = "custom" ]; then
                say "Note: the icon pinning needs fit content, so it stays passive in custom."
            fi
            exit 0
        fi
    fi
    # No running shell to ask: fall back to the config file, effective on the
    # next start of plasmashell.
    case "$wanted" in
        fit) num=1 ;;
        custom) num=2 ;;
    esac
    kwriteconfig6 --file "$SHELLRC" --group PlasmaViews --group "Panel ${pid:-0}" --key panelLengthMode "$num"
    say "Panel length mode written to plasmashellrc: $wanted ($num). It takes effect"
    say "when plasmashell starts next."
    exit 0
fi

if [ "${1:-}" = "--check" ]; then
    pid="$(panel_id)"
    mode="$(panel_mode)"
    say "panel id:                ${pid:-(not readable)}"
    say "packages:"
    packages | sed 's/^/  /'
    say "spacer applets:          $(python3 "$SPACERS" status --panel "${pid:-0}" 2>&1 | tr '\n' ' ')"
    say "spacer widths:           $(spacer_geometry)"
    say "panel length mode:       ${mode:-(not readable)}"
    say "  (plasmashellrc says:   $(kreadconfig6 --file "$SHELLRC" --group PlasmaViews --group "Panel ${pid:-0}" --key panelLengthMode --default '(not set)'))"
    say "panel length clamp:      $(panel_clamp)"
    say "restLength:              $(rest_length_of "Script-$ID") px"
    say "pinIcons:                $(kreadconfig6 --file kwinrc --group "Script-$ID" --key pinIcons --default false)"
    say "panel length now:        $(measure_length) px"
    say ""
    report_mode "$mode" "$(panel_clamp)"
    exit 0
fi

if [ "${1:-}" = "--remove-spacers" ]; then
    pid="$(panel_id)"
    stop_plasma
    python3 "$SPACERS" remove --panel "$pid"
    start_plasma || say "plasmashell did not come back, please start it by hand"
    exit 0
fi

say "== Installing Dynamic Taskbar Width"

if packages | grep -qx "$ID"; then
    kpackagetool6 --type KWin/Script --upgrade "$PKG"
    say "Package updated."
else
    kpackagetool6 --type KWin/Script --install "$PKG"
    say "Package installed."
fi

current="$(rest_length_of "Script-$ID")"
for old in $FORMER_IDS; do
    old_rest="$(rest_length_of "Script-$old")"
    if [ "$old_rest" -gt 0 ] && [ "$current" -lt 1 ]; then
        kwriteconfig6 --file kwinrc --group "Script-$ID" --key restLength "$old_rest"
        current="$old_rest"
        say "Resting length migrated from $old: ${old_rest} px"
    fi
    if packages | grep -qx "$old"; then
        kpackagetool6 --type KWin/Script --remove "$old" || true
        say "Old package $old removed."
    fi
    kwriteconfig6 --file kwinrc --group Plugins --key "${old}Enabled" --delete 2>/dev/null || true
    for key in restLength pinIcons enabled panelIndex onlyPanelScreen sameDesktopOnly includeFullscreen; do
        kwriteconfig6 --file kwinrc --group "Script-$old" --key "$key" --delete 2>/dev/null || true
    done
    kwin /Scripting org.kde.kwin.Scripting.unloadScript "$old" >/dev/null 2>&1 || true
done

PID_PANEL="$(panel_id)"
if [ -z "$PID_PANEL" ]; then
    say "Panel not found, is plasmashell running? Skipping the spacer applets."
else
    cp "$APPLETSRC" "$APPLETSRC.dtw-backup" 2>/dev/null || true
    stop_plasma
    python3 "$SPACERS" ensure --panel "$PID_PANEL"
    start_plasma || say "plasmashell did not come back, please start it by hand"
    say "Spacer applets in the panel: $(spacer_geometry)"
fi

if [ "$current" -gt 0 ]; then
    say "Resting length stays at ${current} px (already configured)."
else
    length="$(measure_length)"
    if [ -n "$length" ] && [ "$length" -gt 0 ] 2>/dev/null; then
        kwriteconfig6 --file kwinrc --group "Script-$ID" --key restLength "$length"
        say "Resting length measured and written: ${length} px"
    else
        say "Resting length could NOT be measured. Set it in the settings, otherwise the script stays passive."
    fi
fi

kwriteconfig6 --file kwinrc --group Plugins --key "${ID}Enabled" true
say "Script enabled in kwinrc."

kwin /Scripting org.kde.kwin.Scripting.unloadScript "$ID" >/dev/null 2>&1 || true
kwin /Scripting org.kde.kwin.Scripting.loadScript "$SKRIPT" "$ID" >/dev/null || true
kwin /Scripting org.kde.kwin.Scripting.start >/dev/null || true
sleep 1

if journalctl --user --since "15 seconds ago" -o cat --no-pager 2>/dev/null | grep -q "$ID: started"; then
    say "Script is running."
else
    say "Script did not report to the journal. Check: journalctl --user --since '2 min ago' | grep $ID"
fi

say ""
mode="$(panel_mode)"
report_mode "$mode" "$(panel_clamp)"
say ""
say "Icon pinning is off by default. Switch it on in System Settings -> Window"
say "Management -> KWin Scripts -> Dynamic Taskbar Width -> gear icon."
