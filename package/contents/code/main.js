// SPDX-License-Identifier: MIT
//
// Dynamic Taskbar Width on Maximized Windows (KWin script, Plasma 6).
//
// The floating panel grows to the full screen width while a window is
// maximized and returns to its resting width afterwards. With pinIcons the
// panel grows around its content: two spacer applets, one at each end, take
// half of the extra width each, so the icons keep their absolute position
// instead of sliding to the screen edges.
//
// Works in the two panel length modes where the panel is not screen-wide by
// definition:
//   fit     the panel is exactly as wide as its content. The spacers are part
//           of that content, so widening them widens the panel.
//   custom  the panel length is its content length clamped to
//           [minimumLength, maximumLength]. The spacers still widen the
//           content, and the clamp is widened for the time of the expansion so
//           it cannot cut the panel back. Both clamps and the length are put
//           back on the way out.
//   fill    the panel is always screen-wide. Nothing to do, the script stays
//           out of the way and says so once in the journal.
//
// The mode is read at runtime and never written: the panel length mode belongs
// to the user, and plasmashell persists it in plasmashellrc.
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
var SCREEN_SLACK = 6;   // pixels kept free, see expandPinned()

var cfg = null;
var expanded = null;    // null = unknown, true/false = the state we applied
var appliedMode = null; // 'fit', 'custom' or 'fill': what we did last time
var saved = null;       // resting length and clamps of the current expansion
var want = null;        // latest requested state, the D-Bus answer acts on it
var acting = false;     // a state query is in flight
var fillLogged = false; // the fill-mode note goes to the journal once

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

// The dock window is exactly the visible panel (measured: 1062,1368 1316x72 for
// a 1316 px panel), the value reported as panels()[i].length is 16 px smaller
// because of the floating paddings. All width arithmetic uses the dock.
function dockWidth() {
    var dock = panelDock();
    return dock ? Math.round(dock.frameGeometry.width) : -1;
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
// value adds exactly that much panel on each side, because the panel grows
// around its content in fit-content and in custom mode.
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

// The length clamp of a custom-length panel, persisted by plasmashell in
// plasmashellrc. max first: setMinimumLength() raises the maximum when the new
// minimum is larger, which would leave the pair inconsistent the other way
// round. Both values are checked integers.
function sendClamp(min, max) {
    var a = parseInt(min, 10);
    var b = parseInt(max, 10);
    if (isNaN(a) || isNaN(b) || a < LENGTH_MIN || b < LENGTH_MIN ||
        a > LENGTH_MAX || b > LENGTH_MAX) {
        print("dynamic-taskbar-width: refusing clamp " + min + "/" + max);
        return;
    }
    var payload =
        "var p = panels()[" + cfg.panelIndex + "];" +
        "if (p) { p.maximumLength = " + b + "; p.minimumLength = " + a + "; }";
    callDBus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell",
             "evaluateScript", payload);
    print("dynamic-taskbar-width: clamps -> " + a + ".." + b);
}

// Reads mode, length, clamp and the number of spacer applets in one call.
// evaluateScript answers with whatever print() produced, and callDBus hands
// that answer to the callback (measured with plasmashell 6.8.1).
function queryPanelState(callback) {
    var payload =
        "var out = 'DTW -1 0 none -1 -1';" +
        "var p = panels()[" + cfg.panelIndex + "];" +
        "if (p) { var n = 0; var ws = p.widgets();" +
        "for (var i = 0; i < ws.length; i++) {" +
        "ws[i].currentConfigGroup = ['General'];";
    payload +=
        "var r = ws[i].readConfig('dtwRole', '');" +
        "if (r === 'left' || r === 'right') { n++; } }" +
        "out = 'DTW ' + p.length + ' ' + n + ' ' + p.lengthMode + ' ' +";
    payload +=
        " p.minimumLength + ' ' + p.maximumLength; }" +
        "print(out);";
    callDBus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell",
             "evaluateScript", payload,
             function (reply) {
                 var m = /DTW\s+(-?\d+)\s+(\d+)\s+(\w+)\s+(-?\d+)\s+(-?\d+)/.exec(String(reply || ""));
                 if (!m) {
                     callback(null);
                     return;
                 }
                 callback({
                     length: parseInt(m[1], 10),
                     spacers: parseInt(m[2], 10),
                     mode: m[3],
                     min: parseInt(m[4], 10),
                     max: parseInt(m[5], 10)
                 });
             });
}

function targetWidth(full) {
    // Six pixels short of the screen: at exactly the screen width the layout is
    // at its limit and Plasma starts squeezing the spacers unevenly, which
    // moves the icons by tens of pixels. The gap is invisible under the
    // floating panel edge.
    return full - SCREEN_SLACK;
}

function expandPinned(output, done) {
    var full = fullLength(output);
    var rest = dockWidth();
    queryPanelState(function (st) {
        if (want !== true) {
            // The window was restored while the panel was being measured; the
            // collapse already ran, so this answer is stale.
            done();
            return;
        }
        if (st === null) {
            print("dynamic-taskbar-width: panel state unreadable, falling back to a plain length change");
            sendLength(full);
            appliedMode = "unknown";
            done();
            return;
        }
        if (st.mode === "fill") {
            appliedMode = "fill";
            if (!fillLogged) {
                fillLogged = true;
                print("dynamic-taskbar-width: panel length mode is 'fill', the panel is always as wide as the screen there, so there is nothing to widen. Use 'fit content' or 'custom' to let the panel grow around its icons.");
            }
            done();
            return;
        }
        if (rest < LENGTH_MIN || rest >= full) {
            print("dynamic-taskbar-width: panel width " + rest + " unusable, falling back to a plain length change");
            sendLength(full);
            appliedMode = "unknown";
            done();
            return;
        }
        var target = targetWidth(full);
        saved = {rest: rest, length: st.length, min: st.min, max: st.max};
        appliedMode = st.mode;
        var side = Math.max(0, Math.round((target - rest) / 2));
        if (st.mode === "custom") {
            // In custom mode the panel is its content length clamped to
            // [minimumLength, maximumLength], which gives two different cases:
            //  - the spacers can push the content up to the target, then only
            //    the clamp has to allow it and the spacers do the work;
            //  - the clamp is already wider than the content (a panel with a
            //    fixed length, min == max). Then the clamp dictates the width
            //    and spacers only shift the content around, so the clamp is
            //    pinned to the target instead and the spacers stay at zero.
            if (st.length + 2 * side < st.min) {
                print("dynamic-taskbar-width: custom mode, the clamp " + st.min +
                      ".." + st.max + " is wider than the panel content, so it " +
                      "sets the width: pinning it to " + target + " px");
                sendClamp(target, target);
                done();
                return;
            }
            var lo = Math.min(st.min, target);
            var hi = Math.max(st.max, target);
            sendClamp(lo, hi);
        }
        if (st.spacers < SPACERS_EXPECTED) {
            print("dynamic-taskbar-width: only " + st.spacers + " spacers found, falling back to a plain length change");
            if (st.mode === "custom") {
                // A plain length change does not hold, the clamp does.
                sendClamp(target, target);
            } else {
                sendLength(full);
            }
            done();
            return;
        }
        print("dynamic-taskbar-width: " + st.mode + " mode, panel " + rest +
              " px, screen " + full + " px, spacer " + side + " px, target " +
              target + " px");
        sendSpacerWidth(side);
        done();
    });
}

function collapse() {
    if (appliedMode === "fill") {
        // Nothing was changed, nothing to undo.
        appliedMode = null;
        return;
    }
    if (appliedMode === "fit" || appliedMode === "unknown") {
        sendSpacerWidth(0);
        if (saved !== null) {
            sendLength(saved.length);
            print("dynamic-taskbar-width: back to the resting width " + saved.rest +
                  " px (length " + saved.length + " px)");
        }
        saved = null;
        appliedMode = null;
        return;
    }
    if (appliedMode === "custom") {
        sendSpacerWidth(0);
        if (saved !== null) {
            // Spacers zero first, then the clamp: restoring a minimum that is
            // larger than the current content would snap the panel wide again.
            sendClamp(saved.min, saved.max);
            sendLength(saved.length);
            print("dynamic-taskbar-width: back to the resting width " + saved.rest +
                  " px, clamps " + saved.min + ".." + saved.max);
        }
        saved = null;
        appliedMode = null;
        return;
    }
    appliedMode = null;
}

// One state query at a time. Events arrive faster than a D-Bus round trip, so
// the callback always works on the latest requested state and loops once more
// when another change came in meanwhile.
function step() {
    if (acting || want === null || want === expanded) {
        return;
    }
    acting = true;
    var goal = want;
    if (goal) {
        var dock = panelDock();
        var output = (dock && dock.output) ? dock.output : workspace.activeScreen;
        if (!output) {
            acting = false;
            return;
        }
        if (cfg.pinIcons) {
            // expandPinned answers asynchronously through its callback, so the
            // state is only marked as applied once the panel query returned.
            expandPinned(output, function () {
                acting = false;
                expanded = goal;
                step();
            });
            return;
        }
        sendLength(fullLength(output));
    } else {
        collapse();
    }
    expanded = goal;
    acting = false;
    step();
}

function apply(expand) {
    want = expand;
    step();
}

function update() {
    // Re-read on every event so a change in the settings dialog takes effect
    // without restarting KWin or the session.
    loadConfig();
    if (!cfg.enabled) {
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
        want = null;
        saved = null;
        appliedMode = null;
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
