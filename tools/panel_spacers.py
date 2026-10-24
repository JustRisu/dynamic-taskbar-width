#!/usr/bin/env python3
"""Verwaltet die beiden Abstandshalter im Panel (appletsrc).

Das Panel im Modus FitContent ist genau so breit wie sein Inhalt. Zwei
Abstandshalter mit je (Bildschirmbreite - Ruhebreite)/2 links und rechts
lassen die Leiste symmetrisch wachsen, ohne den Inhalt zu verschieben.

Aufruf (plasmashell muss dafuer gestoppt sein, sonst schreibt es die Datei
beim Beenden zurueck):

    panel_spacers.py status  --panel 126
    panel_spacers.py ensure  --panel 126
    panel_spacers.py remove  --panel 126
"""
import argparse
import os
import re
import shutil
import sys

PLUGIN = "org.kde.plasma.panelspacer"
MARKER = "dtwRole"
CONFIG = os.path.expanduser("~/.config/plasma-org.kde.plasma.desktop-appletsrc")


def read():
    with open(CONFIG, encoding="utf-8") as fh:
        return fh.read().split("\n")


def write(lines):
    tmp = CONFIG + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    shutil.copymode(CONFIG, tmp)
    os.replace(tmp, CONFIG)


def applet_texts(lines, panel):
    """{applet_id: Text aller Bloecke dieses Applets} fuer ein Panel.

    Plasma schreibt die Konfiguration in Untergruppen wie
    [Containments][126][Applets][201][Configuration][General]. Deshalb wird pro
    Applet ueber alle seine Bloecke gesammelt, nicht nur ueber den Kopfblock.
    """
    prefix = "[Containments][%s][Applets][" % panel
    data = {}
    current = None
    for line in lines:
        if line.startswith(prefix):
            m = re.match(r"\[Containments\]\[%s\]\[Applets\]\[(\d+)\]" % panel, line)
            current = m.group(1) if m else None
        elif line.startswith("["):
            current = None
        if current is not None:
            data[current] = data.get(current, "") + line + "\n"
    return data


def all_marked(lines, panel):
    """ids aller Applets mit dtwRole-Markierung, auch wenn eine Rolle doppelt ist."""
    out = []
    for aid, text in applet_texts(lines, panel).items():
        if PLUGIN in text and re.search(r"^%s=(left|right)$" % MARKER, text, re.M):
            out.append(aid)
    return out

def roles(lines, panel):
    """{role: applet_id} der markierten Abstandshalter."""
    out = {}
    for aid, text in applet_texts(lines, panel).items():
        if PLUGIN not in text:
            continue
        m = re.search(r"^%s=(left|right)$" % MARKER, text, re.M)
        if m:
            out[m.group(1)] = aid
    return out


def order_lines(lines, panel):
    """(index, ids) der AppletOrder-Zeile des Panels, oder (None, [])."""
    header = "[Containments][%s][General]" % panel
    inside = False
    for i, line in enumerate(lines):
        if line.strip() == header:
            inside = True
            continue
        if inside and line.startswith("["):
            return None, []
        if inside and line.startswith("AppletOrder="):
            return i, [a for a in line.split("=", 1)[1].split(";") if a]
    return None, []


def cmd_status(args):
    found = roles(read(), args.panel)
    if not found:
        print("keine")
        return 1
    print(" ".join("%s=%s" % (role, found.get(role, "-")) for role in ("left", "right")))
    return 0 if len(found) == 2 else 1


def cmd_ensure(args):
    lines = read()
    found = roles(lines, args.panel)
    if len(found) == 2:
        print("schon vorhanden (links %s, rechts %s)" % (found["left"], found["right"]))
        return 0

    ids = [int(a) for a in applet_texts(lines, args.panel)]
    new = {}
    for role in ("left", "right"):
        if role in found:
            new[role] = found[role]
            continue
        aid = str(max(ids + [200]) + 1)
        ids.append(int(aid))
        new[role] = aid

    insert_at = None
    for i, line in enumerate(lines):
        if line.strip() == "[Containments][%s][General]" % args.panel:
            insert_at = i
            break
    if insert_at is None:
        print("FEHLER: [Containments][%s][General] nicht gefunden" % args.panel)
        return 1

    blocks = []
    for role in ("left", "right"):
        if role in found:
            continue
        aid = new[role]
        blocks += [
            "[Containments][%s][Applets][%s]" % (args.panel, aid),
            "immutability=1",
            "plugin=" + PLUGIN,
            "",
            "[Containments][%s][Applets][%s][Configuration][General]" % (args.panel, aid),
            "expanding=false",
            "length=0",
            "%s=%s" % (MARKER, role),
            "",
        ]
    lines = lines[:insert_at] + blocks + lines[insert_at:]

    idx, order = order_lines(lines, args.panel)
    if idx is None:
        print("FEHLER: AppletOrder nicht gefunden")
        return 1
    order = [a for a in order if a not in new.values()]
    order = [new["left"]] + order + [new["right"]]
    lines[idx] = "AppletOrder=" + ";".join(order)

    write(lines)
    print("angelegt: links %s, rechts %s" % (new["left"], new["right"]))
    return 0


def cmd_remove(args):
    lines = read()
    found = roles(lines, args.panel)
    if not found:
        print("nichts zu entfernen")
        return 0
    drop = set(all_marked(read(), args.panel)) or set(found.values())
    out, skip = [], False
    for line in lines:
        if line.startswith("["):
            m = re.match(r"\[Containments\]\[%s\]\[Applets\]\[(\d+)\]" % args.panel, line)
            skip = bool(m and m.group(1) in drop)
        if not skip:
            out.append(line)
    idx, order = order_lines(out, args.panel)
    if idx is not None:
        out[idx] = "AppletOrder=" + ";".join([a for a in order if a not in drop])
    write(out)
    print("entfernt: " + ", ".join("%s(%s)" % (r, i) for r, i in sorted(found.items())))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["status", "ensure", "remove"])
    ap.add_argument("--panel", default="126")
    args = ap.parse_args()
    if not os.path.exists(CONFIG):
        print("FEHLER: %s fehlt" % CONFIG, file=sys.stderr)
        return 1
    return {"status": cmd_status, "ensure": cmd_ensure, "remove": cmd_remove}[args.action](args)


if __name__ == "__main__":
    sys.exit(main())
