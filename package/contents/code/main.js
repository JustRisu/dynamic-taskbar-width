// SPDX-License-Identifier: MIT
//
// Dynamic Taskbar Width on Maximized Windows (KWin script, Plasma 6).
//
// The floating panel grows to the full screen width while a window is
// maximized and returns to its resting length afterwards. With pinIcons the
// panel grows around its content: two spacer applets, one at each end, take
// half of the extra width each, so the icons keep their absolute position
// instead of sliding to the screen edges.
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
var SPACERS_EXPECTED = 2;

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
        pinIcons: cfgBool("pinIcons", false),
        onlyPanelScreen: cfgBool("onlyPanelScreen", true),
        includeFullscreen: cfgBool("includeFullscreen", false),
        sameDesktopOnly: cfgBool("sameDesktopOnly", true)
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

// The only outbound calls. Every value that reaches a payload is a checked
// integer, so no window title, class name or other foreign string can end up
// in the evaluated script. Note that evaluateScript runs at top level: a bare
// `return` there would be a SyntaxError and the whole payload would silently
// do nothing.
function sendLength(length) {
    var n = parseInt(length, 10);
    if (isNaN(n) || n < LENGTH_MIN || n > LENGTH_MAX) {
        print("dynamic-taskbar-width: refusing length " + length);
        return;
    }
    var payload = "var p = panels()[" + cfg.panelIndex + "]; if (p) { p.length = " + n + "; }";
    callDBus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell",
             "evaluateScript", payload);
    print("dynamic-taskbar-width: panel " + cfg.panelIndex + " length -> " + n);
}

// Width of both spacer applets. Zero restores the resting width, a positive
// value adds exactly that much panel on each side, because the panel is only
// as wide as its content in fit-content mode.
function sendSpacerWidth(width) {
    var n = parseInt(width, 10);
    if (isNaN(n) || n < 0 || n > LENGTH_MAX) {
        print("dynamic-taskbar-width: refusing spacer width " + width);
        return;
    }
    var payload =
        "var p = panels()[" + cfg.panelIndex + "];" +
        "if (p) { var ws = p.widgets();" +
        "for (var i = 0; i < ws.length; i++) {" +
        "var w = ws[i]; w.currentConfigGroup = ['General'];" +
        "var r = w.readConfig('dtwRole', '');" +
        "if (r === 'left' || r === 'right') {" +
        "w.writeConfig('length', " + n + "); w.reloadConfig(); } } }";
    callDBus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell",
             "evaluateScript", payload);
    print("dynamic-taskbar-width: spacer width -> " + n);
}

// Reads the current panel length and counts the spacer applets in one call.
// evaluateScript answers with whatever print() produced, and callDBus hands
// that answer to the callback (measured with plasmashell 6.8.1).
function queryPanelState(callback) {
    var payload =
        "var out = 'DTW -1 0';" +
        "var p = panels()[" + cfg.panelIndex + "];" +
        "if (p) { var n = 0; var ws = p.widgets();" +
        "for (var i = 0; i < ws.length; i++) {" +
        "ws[i].currentConfigGroup = ['General'];" +
        "var r = ws[i].readConfig('dtwRole', '');" +
        "if (r === 'left' || r === 'right') { n++; } }" +
        "out = 'DTW ' + p.length + ' ' + n; }" +
        "print(out);";
    callDBus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell",
             "evaluateScript", payload,
             function (reply) {
                 var m = /DTW\s+(-?\d+)\s+(\d+)/.exec(String(reply || ""));
                 if (!m) {
                     callback(-1, -1);
                     return;
                 }
                 callback(parseInt(m[1], 10), parseInt(m[2], 10));
             });
}

function expandPinned(output) {
    var full = fullLength(output);
    // The dock window is exactly the visible panel (measured: 1062,1368 1316x72
    // for a 1316 px panel), so its width is the number the spacers have to make
    // up for. The content length reported by evaluateScript is 16 px smaller
    // because of the floating paddings and would leave the icons 8 px off.
    var dock = panelDock();
    var rest = dock ? Math.round(dock.frameGeometry.width) : -1;
    queryPanelState(function (contentLength, spacers) {
        if (spacers < SPACERS_EXPECTED) {
            print("dynamic-taskbar-width: only " + spacers + " spacers found, falling back to a plain length change");
            sendLength(full);
            return;
        }
        if (rest < LENGTH_MIN || rest >= full) {
            print("dynamic-taskbar-width: panel width " + rest + " unusable, falling back to a plain length change");
            sendLength(full);
            return;
        }
        var side = Math.round((full - rest) / 2);
        print("dynamic-taskbar-width: panel " + rest + " px, screen " + full +
              " px, spacer " + side + " px, content " + contentLength + " px");
        sendSpacerWidth(side);
    });
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
        if (cfg.pinIcons) {
            expandPinned(output);
        } else {
            sendLength(fullLength(output));
        }
        expanded = true;
    } else {
        if (cfg.pinIcons) {
            sendSpacerWidth(0);
        } else {
            sendLength(cfg.restLength);
        }
        expanded = false;
    }
}

function update() {
    if (!cfg || !cfg.enabled) {
        return;
    }
    if (!cfg.pinIcons && cfg.restLength < 0) {
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
        print("dynamic-taskbar-width: disabled in configuration");
        return;
    }
    if (!cfg.pinIcons && cfg.restLength < 0) {
        print("dynamic-taskbar-width: no resting length configured, staying passive");
        return;
    }
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
    print("dynamic-taskbar-width: started, pinIcons " + cfg.pinIcons +
          ", resting length " + cfg.restLength + " px");
    update();
}

init();
