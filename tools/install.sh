#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Installs Panel Full Width, measures the current panel length on the first run
# and writes it as the resting length. Without that value the script stays
# passive, because it must never widen a panel without a known way back.
#
# An already configured resting length is never overwritten: it may have been
# set in the settings dialog on purpose.

set -euo pipefail

ID="panel-full-width"
OLD_ID="panelweite"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$HERE/package"
SKRIPT="$HOME/.local/share/kwin/scripts/$ID/contents/code/main.js"

say() { printf '%s\n' "$*"; }

kwin() { qdbus6 org.kde.KWin "$@"; }

# evaluateScript returns the print() output as the reply to the D-Bus call and
# qdbus6 writes it to stdout (measured 2026-10-24 with plasmashell 6.8.1).
measure_length() {
    local marker="PANELFULLWIDTH_MEASURE_$RANDOM$RANDOM"
    local code="print('$marker ' + panels()[0].length);"
    local out
    out="$(qdbus6 org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript "$code" 2>&1 || true)"
    printf '%s\n' "$out" | sed -n "s/.*$marker \([0-9]\{1,6\}\).*/\1/p" | tail -n1
}

say "== Installing Panel Full Width"

if kpackagetool6 --type KWin/Script --list 2>/dev/null | grep -qx "$ID"; then
    kpackagetool6 --type KWin/Script --upgrade "$PKG"
    say "Package updated."
else
    kpackagetool6 --type KWin/Script --install "$PKG"
    say "Package installed."
fi

# Migration from the former name "panelweite": keep the measured value, drop
# the old package and its configuration group.
old_rest="$(kreadconfig6 --file kwinrc --group "Script-$OLD_ID" --key restLength --default -1 2>/dev/null || echo -1)"
if [ -n "${old_rest}" ] && [ "${old_rest}" -gt 0 ] 2>/dev/null; then
    kwriteconfig6 --file kwinrc --group "Script-$ID" --key restLength "$old_rest"
    say "Resting length migrated from $OLD_ID: ${old_rest} px"
fi
if kpackagetool6 --type KWin/Script --list 2>/dev/null | grep -qx "$OLD_ID"; then
    kpackagetool6 --type KWin/Script --remove "$OLD_ID" || true
    say "Old package $OLD_ID removed."
fi
kwriteconfig6 --file kwinrc --group Plugins --key "${OLD_ID}Enabled" --delete 2>/dev/null || true
kwriteconfig6 --file kwinrc --group "Script-$OLD_ID" --delete 2>/dev/null || true

current="$(kreadconfig6 --file kwinrc --group "Script-$ID" --key restLength --default -1 2>/dev/null || echo -1)"
if [ -n "${current}" ] && [ "${current}" -gt 0 ] 2>/dev/null; then
    say "Resting length stays at ${current} px (already configured)."
else
    length="$(measure_length)"
    if [ -n "${length}" ] && [ "${length}" -gt 0 ] 2>/dev/null; then
        kwriteconfig6 --file kwinrc --group "Script-$ID" --key restLength "$length"
        say "Resting length measured and written: ${length} px"
    else
        say "Resting length could NOT be measured. Set it in the settings, otherwise the script stays passive."
    fi
fi

kwriteconfig6 --file kwinrc --group Plugins --key "${ID}Enabled" true
say "Script enabled in kwinrc."

# reconfigure only rewrites configuration, it does not reload a script.
kwin /Scripting org.kde.kwin.Scripting.unloadScript "$ID" >/dev/null 2>&1 || true
kwin /Scripting org.kde.kwin.Scripting.loadScript "$SKRIPT" "$ID" >/dev/null || true
kwin /Scripting org.kde.kwin.Scripting.start >/dev/null || true
sleep 1

if journalctl --user --since "15 seconds ago" -o cat --no-pager 2>/dev/null | grep -q "panel-full-width: started"; then
    say "Script is running."
else
    say "Script did not report to the journal. Check: journalctl --user --since '2 min ago' | grep panel-full-width"
fi
