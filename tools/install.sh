#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Installiert Panelweite, misst die aktuelle Panel-Laenge und traegt sie als
# Ruhelaenge ein. Ohne diesen Wert bleibt das Skript passiv, weil es sonst ein
# Panel verbreitern koennte, ohne es zurueckzusetzen.

set -euo pipefail

ID="panelweite"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$HERE/package"
SKRIPT="$HOME/.local/share/kwin/scripts/$ID/contents/code/main.js"

say() { printf '%s\n' "$*"; }

kwin() { qdbus6 org.kde.KWin "$@"; }

# evaluateScript liefert die print()-Ausgabe als Antwort auf den D-Bus-Aufruf
# zurueck, qdbus6 schreibt sie nach stdout (gemessen am 24.10.2026 mit
# plasmashell 6.8.1). Kein Umweg ueber das Journal noetig.
measure_length() {
    local marker="PANELWEITE_MEASURE_$RANDOM$RANDOM"
    local code="print('$marker ' + panels()[0].length);"
    local out
    out="$(qdbus6 org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript "$code" 2>&1 || true)"
    printf '%s\n' "$out" | sed -n "s/.*$marker \([0-9]\{1,6\}\).*/\1/p" | tail -n1
}

say "== Panelweite installieren"

if kpackagetool6 --type KWin/Script --list 2>/dev/null | grep -qx "$ID"; then
    kpackagetool6 --type KWin/Script --upgrade "$PKG"
    say "Paket aktualisiert."
else
    kpackagetool6 --type KWin/Script --install "$PKG"
    say "Paket installiert."
fi

length="$(measure_length)"
if [ -n "${length}" ] && [ "${length}" -gt 0 ] 2>/dev/null; then
    kwriteconfig6 --file kwinrc --group "Script-$ID" --key restLength "$length"
    say "Ruhelaenge gemessen und eingetragen: ${length} px"
else
    say "Ruhelaenge NICHT messbar. Bitte in den Einstellungen eintragen, sonst bleibt das Skript passiv."
fi

kwriteconfig6 --file kwinrc --group Plugins --key "${ID}Enabled" true
say "Skript in kwinrc aktiviert."

# reconfigure schreibt nur die Konfiguration um, es laedt kein Skript neu.
# Gemessen am 24.10.2026: ohne unload/load lief das alte Skript weiter.
kwin /Scripting org.kde.kwin.Scripting.unloadScript "$ID" >/dev/null 2>&1 || true
kwin /Scripting org.kde.kwin.Scripting.loadScript "$SKRIPT" "$ID" >/dev/null || true
kwin /Scripting org.kde.kwin.Scripting.start >/dev/null || true
sleep 1

if journalctl --user --since "15 seconds ago" -o cat --no-pager 2>/dev/null | grep -q "panelweite: started"; then
    say "Skript laeuft."
else
    say "Skript meldet sich nicht im Journal. Pruefen mit: journalctl --user --since '2 min ago' | grep panelweite"
fi
