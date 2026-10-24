#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Installs Dynamic Taskbar Width, measures the current panel length on the first
# run and writes it as the resting length. Without that value the script stays
# passive, because it must never widen a panel without a known way back.
#
# An already configured resting length is never overwritten: it may have been
# set in the settings dialog on purpose.
#
# Former package ids (panel-full-width, panelweite) are migrated: their resting
# length is taken over, their package and configuration group are removed.
#
#   ./install.sh          install or upgrade for this user
#   ./install.sh --check  only report the state, change nothing

set -euo pipefail

ID="dynamic-taskbar-width"
FORMER_IDS="panel-full-width panelweite"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$HERE/package"
SKRIPT="$HOME/.local/share/kwin/scripts/$ID/contents/code/main.js"

say() { printf '%s\n' "$*"; }

kwin() { qdbus6 org.kde.KWin "$@"; }

packages() { kpackagetool6 --type KWin/Script --list 2>/dev/null || true; }

# evaluateScript returns the print() output as the reply to the D-Bus call and
# qdbus6 writes it to stdout (measured 2026-10-24 with plasmashell 6.8.1).
measure_length() {
    local marker="DYNAMICTASKBARWIDTH_MEASURE_$RANDOM$RANDOM"
    local code="print('$marker ' + panels()[0].length);"
    local out
    out="$(qdbus6 org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript "$code" 2>&1 || true)"
    printf '%s\n' "$out" | sed -n "s/.*$marker \([0-9]\{1,6\}\).*/\1/p" | tail -n1
}

# kreadconfig6 prints the default when the key is missing. An empty or
# non-numeric value collapses to -1, which means "not configured".
rest_length_of() {
    local group="$1"
    local raw
    raw="$(kreadconfig6 --file kwinrc --group "$group" --key restLength --default -1 2>/dev/null || echo -1)"
    case "$raw" in
        ''|*[!0-9-]*) printf '%s' -1 ;;
        *) printf '%s' "$raw" ;;
    esac
}

if [ "${1:-}" = "--check" ]; then
    say "packages:"
    packages | sed 's/^/  /'
    say "configured resting length ($ID): $(rest_length_of "Script-$ID") px"
    say "enabled in kwinrc: $(kreadconfig6 --file kwinrc --group Plugins --key "${ID}Enabled" --default false)"
    say "panel length now: $(measure_length) px"
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

# Migration: take the resting length from a former id, then drop that package,
# its enable switch and its configuration group.
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
    kwriteconfig6 --file kwinrc --group "Script-$old" --delete 2>/dev/null || true
    kwin /Scripting org.kde.kwin.Scripting.unloadScript "$old" >/dev/null 2>&1 || true
done

# A script may already run under the new id after an upgrade; unload it so the
# freshly installed file is what gets loaded below.
kwin /Scripting org.kde.kwin.Scripting.unloadScript "$ID" >/dev/null 2>&1 || true

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

# reconfigure only rewrites configuration, it does not reload a script.
kwin /Scripting org.kde.kwin.Scripting.loadScript "$SKRIPT" "$ID" >/dev/null || true
kwin /Scripting org.kde.kwin.Scripting.start >/dev/null || true
sleep 1

if journalctl --user --since "15 seconds ago" -o cat --no-pager 2>/dev/null | grep -q "$ID: started"; then
    say "Script is running."
else
    say "Script did not report to the journal. Check: journalctl --user --since '2 min ago' | grep $ID"
fi
