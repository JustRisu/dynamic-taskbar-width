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
#  - the panel length mode in plasmashellrc, because the whole feature needs a
#    panel that is exactly as wide as its content (fit-content)
#  - [Script-dynamic-taskbar-width] restLength, measured once from the running
#    panel and never overwritten afterwards
#
#   ./install.sh           install or upgrade
#   ./install.sh --check   report the state, change nothing
#   ./install.sh --remove-spacers   drop the two spacer applets again

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

if [ "${1:-}" = "--check" ]; then
    pid="$(panel_id)"
    say "panel id:                ${pid:-(nicht ermittelbar)}"
    say "packages:"
    packages | sed 's/^/  /'
    say "Abstandshalter:          $(python3 "$SPACERS" status --panel "${pid:-0}" 2>&1 | tr '\n' ' ')"
    say "Breiten laut Plasma:     $(spacer_geometry)"
    say "Laengenmodus:            $(kreadconfig6 --file "$SHELLRC" --group PlasmaViews --group "Panel ${pid:-0}" --key panelLengthMode --default '(nicht gesetzt)')"
    say "restLength:              $(rest_length_of "Script-$ID") px"
    say "pinIcons:                $(kreadconfig6 --file kwinrc --group "Script-$ID" --key pinIcons --default false)"
    say "Panel-Laenge jetzt:      $(measure_length) px"
    exit 0
fi

if [ "${1:-}" = "--remove-spacers" ]; then
    pid="$(panel_id)"
    stop_plasma
    python3 "$SPACERS" remove --panel "$pid"
    start_plasma || say "plasmashell startet nicht, bitte von Hand starten"
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
    say "Panel nicht gefunden, plasmashell laeuft nicht? Abstandshalter werden uebersprungen."
else
    mode="$(kreadconfig6 --file "$SHELLRC" --group PlasmaViews --group "Panel $PID_PANEL" --key panelLengthMode --default '')"
    if [ "$mode" != "1" ]; then
        kwriteconfig6 --file "$SHELLRC" --group PlasmaViews --group "Panel $PID_PANEL" --key panelLengthMode 1
        say "Panel-Laengenmodus auf fit-content gesetzt (war: ${mode:-nicht gesetzt})."
        say "  Rueckweg: kwriteconfig6 --file plasmashellrc --group PlasmaViews --group 'Panel $PID_PANEL' --key panelLengthMode --delete"
    fi

    cp "$APPLETSRC" "$APPLETSRC.dtw-backup" 2>/dev/null || true
    stop_plasma
    python3 "$SPACERS" ensure --panel "$PID_PANEL"
    start_plasma || say "plasmashell startet nicht, bitte von Hand starten"
    say "Abstandshalter im Panel: $(spacer_geometry)"
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
say "Icon pinning is off by default. Switch it on in System Settings -> Window"
say "Management -> KWin Scripts -> Dynamic Taskbar Width -> gear icon."
