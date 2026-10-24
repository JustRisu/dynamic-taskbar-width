// SPDX-License-Identifier: MIT
//
// Panelweite: the floating panel grows to the full screen width while a window
// is maximized, and returns to its resting length afterwards.
//
// Deliberately narrow: this script reads only its own configuration from
// kwinrc and talks only to org.kde.plasmashell. No network, no file access,
// no process execution, no secrets.

var LENGTH_MIN = 32;
var LENGTH_MAX = 20000;
var PANEL_INDEX_MIN = 0;
var PANEL_INDEX_MAX = 16;
var MAXIMIZED_BOTH = 3; // KWin maximise mode: horizontal + vertical
var AREA_FULL = 3;      // KWin ClientAreaOption::FullArea

var cfg = null;
var expanded = null; // null = unknown, true/false = the state we applied

function cfgInt(key, fallback, min, max) {
    var raw = readConfig(key, fallback);
    var n = parseInt(raw, 10);
    if (isNaN(n)) {
        n = fallback;
    }
    if (n < min) {
        n = min;
    }
    if (n > max) {
        n = max;
    }
    return n;
}

function cfgBool(key, fallback) {
    var raw = readConfig(key, fallback);
    if (typeof raw === "boolean") {
        return raw;
    }
    var s = String(raw).toLowerCase();
    return s === "true" || s === "1";
}

function loadConfig() {
    cfg = {
        enabled: cfgBool("enabled", true),
        restLength: cfgInt("restLength", -1, -1, LENGTH_MAX),
        panelIndex: cfgInt("panelIndex", 0, PANEL_INDEX_MIN, PANEL_INDEX_MAX),
        onlyPanelScreen: cfgBool("onlyPanelScreen", true),
        includeFullscreen: cfgBool("includeFullscreen", false),
        sameDesktopOnly: cfgBool("sameDesktopOnly", true),
        pinIcons: cfgBool("pinIcons", false)
    };
}

// The panel shows up as a dock window. There is normally exactly one; if not,
// the widest one is taken, because that is the panel that spans the screen.
function panelDock() {
    var wins = workspace.windowList();
    var best = null;
    for (var i = 0; i < wins.length; i++) {
        var w = wins[i];
        if (!w.dock || w.deleted) {
            continue;
        }
        if (best === null || w.frameGeometry.width > best.frameGeometry.width) {
            best = w;
        }
    }
    return best;
}

function fullLength(output) {
    var area = workspace.clientArea(AREA_FULL, output, workspace.currentDesktop);
    return Math.round(area.width);
}

function onCurrentDesktop(w) {
    if (!cfg.sameDesktopOnly) {
        return true;
    }
    if (w.onAllDesktops) {
        return true;
    }
    try {
        var current = workspace.currentDesktop;
        for (var i = 0; i < w.desktops.length; i++) {
            if (w.desktops[i].id === current.id) {
                return true;
            }
        }
        return false;
    } catch (e) {
        return true;
    }
}

function wantsFullWidth() {
    var dock = cfg.onlyPanelScreen ? panelDock() : null;
    var panelScreen = (dock && dock.output) ? dock.output.name : null;
    var wins = workspace.windowList();
    for (var i = 0; i < wins.length; i++) {
        var w = wins[i];
        if (w.deleted || w.dock || w.specialWindow) {
            continue;
        }
        if (!onCurrentDesktop(w)) {
            continue;
        }
        if (panelScreen !== null) {
            var screenName = w.output ? w.output.name : null;
            if (screenName !== panelScreen) {
                continue;
            }
        }
        if (w.maximizeMode === MAXIMIZED_BOTH) {
            return true;
        }
        if (cfg.includeFullscreen && w.fullScreen) {
            return true;
        }
    }
    return false;
}

// The only outbound call. Both values are validated integers, so no window
// title, class name or other foreign string can reach the script payload.
function sendLength(length) {
    var n = parseInt(length, 10);
    if (isNaN(n) || n < LENGTH_MIN || n > LENGTH_MAX) {
        print("panelweite: refusing length " + length);
        return;
    }
    var payload = "var p = panels()[" + cfg.panelIndex + "]; if (p) { p.length = " + n + "; }";
    callDBus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell",
             "evaluateScript", payload);
    print("panelweite: panel " + cfg.panelIndex + " length -> " + n);
}

// Keeping the icons in place is done with two panel spacers: one at the very
// start, one at the very end of the panel. They eat the extra width, so the
// applets stay where they were. Without them Plasma spreads the applets over
// the full length and the content wanders with the edges.
//
// Both states are created here and not in the installer, so the checkbox is the
// single source of truth. The payload contains no foreign strings. evaluateScript
// runs at top level, so a bare `return` would be a SyntaxError and the whole
// payload would silently do nothing.
function syncSpacers() {
    var idx = cfg.panelIndex;
    var payload;
    if (cfg.pinIcons) {
        payload = "var p = panels()[" + idx + "]; if (p) {" +
                  " var ws = p.widgets(); var sp = [];" +
                  " for (var i = 0; i < ws.length; i++) {" +
                  "  if (ws[i].type === 'org.kde.plasma.panelspacer') { sp.push(ws[i]); }" +
                  " }" +
                  " while (sp.length < 2) { sp.push(p.addWidget('org.kde.plasma.panelspacer')); }" +
                  " while (sp.length > 2) { sp.pop().remove(); }" +
                  " sp[0].index = 0;" +
                  " sp[sp.length - 1].index = 9999;" +
                  " }";
    } else {
        payload = "var p = panels()[" + idx + "]; if (p) {" +
                  " var ws = p.widgets();" +
                  " for (var i = ws.length - 1; i >= 0; i--) {" +
                  "  if (ws[i].type === 'org.kde.plasma.panelspacer') { ws[i].remove(); }" +
                  " }" +
                  " }";
    }
    callDBus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell",
             "evaluateScript", payload);
    print("panelweite: pin icons " + (cfg.pinIcons ? "on" : "off"));
}

function apply(expand) {
    if (expand === expanded) {
        return;
    }
    if (expand) {
        var dock = panelDock();
        var output = (dock && dock.output) ? dock.output : workspace.activeScreen;
        if (!output) {
            return;
        }
        sendLength(fullLength(output));
        expanded = true;
    } else {
        sendLength(cfg.restLength);
        expanded = false;
    }
}

function update() {
    if (!cfg || !cfg.enabled || cfg.restLength < 0) {
        return;
    }
    apply(wantsFullWidth());
}

function watchWindow(w) {
    if (!w) {
        return;
    }
    if (w.dock) {
        // A restarted plasmashell creates a new dock; resync from scratch.
        expanded = null;
        update();
        return;
    }
    w.maximizedChanged.connect(update);
    w.fullScreenChanged.connect(update);
    w.outputChanged.connect(update);
    w.desktopsChanged.connect(update);
    w.minimizedChanged.connect(update);
    w.closed.connect(update);
}

function init() {
    loadConfig();
    if (!cfg.enabled) {
        print("panelweite: disabled in configuration");
        return;
    }
    if (cfg.restLength < 0) {
        print("panelweite: no resting length configured, staying passive");
        return;
    }
    syncSpacers();
    var wins = workspace.windowList();
    for (var i = 0; i < wins.length; i++) {
        watchWindow(wins[i]);
    }
    workspace.windowAdded.connect(function (w) {
        watchWindow(w);
        update();
    });
    workspace.windowRemoved.connect(update);
    workspace.currentDesktopChanged.connect(update);
    workspace.screensChanged.connect(update);
    print("panelweite: started, resting length " + cfg.restLength + " px");
    update();
}

init();
