# Panelweite

Ein KWin-Skript für KDE Plasma 6: Das schwebende Panel wächst auf die volle
Bildschirmbreite, sobald ein Fenster maximiert ist, und springt beim
Wiederherstellen auf seine Ruhelänge zurück.

## Voraussetzungen

- KDE Plasma 6 (getestet mit 6.8.1 auf Wayland)
- Ein Plasma-Panel, dessen Länge sich per `panels()[i].length` setzen lässt
  (Standard-Panel, `org.kde.panel`)
- `qdbus6`, `kpackagetool6`, `kwriteconfig6` (Teil von Plasma)

## Installation

```bash
./tools/install.sh
```

Das Skript installiert das Paket, misst die aktuelle Panel-Länge über
evaluateScript und trägt sie als Ruhelänge ein, aktiviert das Skript in
`kwinrc` und lädt KWin neu.

Von Hand:

```bash
kpackagetool6 --type KWin/Script --install package
kwriteconfig6 --file kwinrc --group Script-panelweite --key restLength 1316
kwriteconfig6 --file kwinrc --group Plugins --key panelweiteEnabled true
qdbus6 org.kde.KWin /KWin reconfigure
```

## Einstellungen

Systemeinstellungen → Fensterverwaltung → KWin-Skripte → Panelweite →
Zahnrad. Dort lassen sich ändern:

| Einstellung | Bedeutung | Vorgabe |
|---|---|---|
| Aktiv | Skript komplett an oder aus | an |
| Ruhelänge (px) | Länge, auf die das Panel zurückspringt. `-1` = passiv, kein Eingriff | -1 |
| Panel-Index | Position des Panels in `panels()`, bei einem Panel `0` | 0 |
| Nur eigener Bildschirm | Nur Fenster auf dem Bildschirm des Panels zählen | an |
| Nur aktueller Desktop | Fenster auf anderen Desktops ignorieren | an |
| Auch bei Vollbild | Auch Vollbild-Fenster verbreitern das Panel | aus |

## Sicherheit

- Das Skript liest ausschließlich seine eigene Konfiguration aus `kwinrc`
  (`readConfig`).
- Es spricht ausschließlich mit `org.kde.plasmashell`
  (`/PlasmaShell`, `evaluateScript`).
- Kein Netzwerk, kein Dateizugriff, kein Start von Programmen, keine
  Hintergrunddienste, keine Secrets.
- Die Werte im erzeugten Skript sind geprüfte Ganzzahlen (32 bis 20000,
  Panel-Index 0 bis 16). Fenstertitel, Klassennamen oder andere fremde
  Zeichenketten gelangen nicht in den Aufruf.
- Ohne gesetzte Ruhelänge tut das Skript nichts. Ein Panel kann dadurch nicht
  breit hängen bleiben.

## Grenzen

- **Tiling** (Fenster an den Rand ziehen, KWin 6 Kacheln) wird nicht
  ausgewertet. Nur echte Maximierung zählt.
- **Ruhelänge ist ein fester Wert.** Wird das Panel von Hand dauerhaft
  verändert, muss der Wert in den Einstellungen nachgezogen werden.
- **Persistenz:** Die per `evaluateScript` gesetzte Länge landet nicht in
  `plasma-org.kde.plasma.desktop-appletsrc` (gemessen mit md5 vor und nach dem
  Setzen). Ein Absturz hinterlässt therefore kein breites Panel; beim Start
  normalisiert das Skript trotzdem.
- **Nur ein Panel.** Bei mehreren Panels wird das breiteste Dock als Panel
  erkannt, gesetzt wird `panels()[panelIndex]`.

## Aufbau

```
package/
├── metadata.json              KPackage-Metadaten, X-KDE-ConfigModule
└── contents/
    ├── code/main.js           Logik: Sensor, Zustand, D-Bus-Aufruf
    ├── config/main.xml        KConfigXT-Definition der Einstellungen
    └── ui/config.ui           Einstellungsdialog (QML)
tools/install.sh               Installation plus Messung der Ruhelänge
```

## Lizenz

MIT, siehe `LICENSE`.
