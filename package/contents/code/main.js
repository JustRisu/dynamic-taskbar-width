// SPDX-License-Identifier: MIT
//
// Dynamic Taskbar Width on Maximized Windows (KWin script, Plasma 6).
//
// The floating panel grows to the full screen width while a window is
// maximized and returns to its resting width afterwards. The icons keep their
// absolute position: two spacer applets, one at each end, take half of the
// extra width each, so the panel grows around its content instead of pushing
// the content to the screen edges.
//
// This needs the panel length mode "fit content": there the panel is exactly
// as wide as its content, which is what makes the spacers widen it. In
// "custom" the clamp and in "fill" the screen decide the width, and the
// spacers cannot hold the icons there (measured, see README); the script stays
// passive in both and says so once in the journal. It never writes the mode:
// panelLengthMode belongs to the user.
//
// The transition is animated: the spacer width is stepped towards its target
// over ANIM_MS with an ease-out curve, so the panel glides instead of jumping.
// KWin's scripting engine has no setTimeout, but it does expose QTimer
// (measured with KWin 6.8.1).
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
// Plasma needs roughly 55 ms per layout round of the panel (measured: 12 spacer
// writes in 190 ms produced only 3 visible width steps), so the frame rate is
// slower than a display refresh on purpose: every frame should land.
var ANIM_MS = 520;      // length of one transition
var FRAME_MS = 26;      // about 20 frames, of which ~9 become visible

var cfg = null;
var expanded = null;    // null = unknown, true/false = the state we applied
var appliedMode = null; // what we did last time: 'fit', 'custom', 'fill' or 'unknown'
var want = null;        // latest requested state, the D-Bus answer acts on it
var acting = false;     // a state query or an animation is in flight
var modeLogged = false; // the unsupported-mode note goes to the journal once

var spacerNow = -1;     // spacer width the panel currently has, -1 = unknown
var animTimer = null;
var animFrom = 0;
var animTo = 0;
var animT0 = 0;
var animDone = null;

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
}

// Reads mode, length and the number of spacer applets in one call.
// evaluateScript answers with whatever print() produced, and callDBus hands
// that answer to the callback (measured with plasmashell 6.8.1).
function queryPanelState(callback) {
    var payload =
        "var out = 'DTW -1 0 none -1';" +
        "var p = panels()[" + cfg.panelIndex + "];" +
        "if (p) { var n = 0; var len = -1; var ws = p.widgets();" +
        "for (var i = 0; i < ws.length; i++) {" +
        "ws[i].currentConfigGroup = ['General'];";
    payload +=
        "var r = ws[i].readConfig('dtwRole', '');" +
        "if (r === 'left' || r === 'right') { n++; if (len < 0) { len = parseInt(ws[i].readConfig('length', -1), 10); } } }" +
        "out = 'DTW ' + p.length + ' ' + n + ' ' + p.lengthMode + ' ' + len; }" +
        "print(out);";
    callDBus("org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell",
             "evaluateScript", payload,
             function (reply) {
                 var m = /DTW\s+(-?\d+)\s+(\d+)\s+(\w+)\s+(-?\d+)/.exec(String(reply || ""));
                 if (!m) {
                     callback(null);
                     return;
                 }
                 callback({
                     length: parseInt(m[1], 10),
                     spacers: parseInt(m[2], 10),
                     mode: m[3],
                     spacerLen: parseInt(m[4], 10)
                 });
             });
}

// Ease-out: fast start, gentle landing. Keeps the growth readable without
// looking like a rubber band.
function easeOut(t) {
    var inv = 1 - t;
    return 1 - inv * inv * inv;
}

// Steps the spacer width from its current value to the target over ANIM_MS.
// One QTimer drives the frames; every change goes to plasmashell, which
// re-lays out the panel, so the panel glides. A new call while running simply
// re-targets from wherever the animation currently is.
function animateSpacers(to, done) {
    var target = Math.max(0, Math.min(LENGTH_MAX, parseInt(to, 10) || 0));
    if (animTimer === null) {
        animTimer = new QTimer();
        animTimer.interval = FRAME_MS;
        animTimer.singleShot = false;
        animTimer.timeout.connect(animTick);
    }
    animDone = done;
    animFrom = spacerNow;
    animTo = target;
    animT0 = Date.now();
    if (target === spacerNow) {
        finishAnimation();
        return;
    }
    if (!animTimer.active) {
        animTimer.start();
    }
}

function animTick() {
    var t = (Date.now() - animT0) / ANIM_MS;
    if (t >= 1) {
        spacerNow = animTo;
        sendSpacerWidth(spacerNow);
        finishAnimation();
        return;
    }
    var value = Math.round(animFrom + (animTo - animFrom) * easeOut(t));
    if (value !== spacerNow) {
        spacerNow = value;
        sendSpacerWidth(spacerNow);
    }
}

function finishAnimation() {
    if (animTimer !== null && animTimer.active) {
        animTimer.stop();
    }
    var cb = animDone;
    animDone = null;
    if (cb) {
        cb();
    }
}

function unsupported(mode, done) {
    appliedMode = mode;
    if (!modeLogged) {
        modeLogged = true;
        if (mode === "fill") {
            print("dynamic-taskbar-width: panel length mode is 'fill', the panel is always as wide as the screen there, so there is nothing to widen. Icon pinning needs 'fit content'.");
        } else {
            print("dynamic-taskbar-width: panel length mode is '" + mode + "', but icon pinning needs 'fit content': there the panel is exactly as wide as its content, which is what makes the spacers widen it. In 'custom' the clamp and in 'fill' the screen decide the width, and the icons cannot be held. Staying passive.");
        }
    }
    done();
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
        if (st.mode !== "fit") {
            unsupported(st.mode, done);
            return;
        }
        if (rest < LENGTH_MIN || rest >= full) {
            print("dynamic-taskbar-width: panel width " + rest + " unusable, falling back to a plain length change");
            sendLength(full);
            appliedMode = "unknown";
            done();
            return;
        }
        if (st.spacers < SPACERS_EXPECTED) {
            print("dynamic-taskbar-width: only " + st.spacers + " spacers found, falling back to a plain length change");
            sendLength(full);
            appliedMode = "unknown";
            done();
            return;
        }
        // Six pixels short of the screen: at exactly the screen width the
        // layout is at its limit and Plasma starts squeezing the spacers
        // unevenly, which moves the icons by tens of pixels. The gap is
        // invisible under the floating panel edge.
        if (st.spacerLen >= 0) {
            spacerNow = st.spacerLen;
        }
        var target = full - SCREEN_SLACK;
        var side = Math.max(0, Math.round((target - rest) / 2));
        print("dynamic-taskbar-width: fit mode, panel " + rest + " px, screen " +
              full + " px, spacer " + side + " px, target " + target + " px");
        appliedMode = "fit";
        animateSpacers(side, done);
    });
}

function collapse(done) {
    if (appliedMode === "custom" || appliedMode === "fill") {
        // Nothing was changed in an unsupported mode, nothing to undo.
        appliedMode = null;
        done();
        return;
    }
    if (appliedMode === "unknown") {
        // The fallback used a plain length change; the resting length comes
        // from the settings there.
        appliedMode = null;
        done();
        return;
    }
    appliedMode = null;
    animateSpacers(0, done);
}

// One state query or animation at a time. Events arrive faster than a D-Bus
// round trip, so the callback always works on the latest requested state and
// loops once more when another change came in meanwhile.
function step() {
    if (acting || want === null || want === expanded) {
        return;
    }
    acting = true;
    var goal = want;
    var finish = function () {
        acting = false;
        expanded = goal;
        step();
    };
    if (goal) {
        var dock = panelDock();
        var output = (dock && dock.output) ? dock.output : workspace.activeScreen;
        if (!output) {
            acting = false;
            return;
        }
        if (cfg.pinIcons) {
            expandPinned(output, finish);
        } else {
            sendLength(fullLength(output));
            finish();
        }
        return;
    }
    if (cfg.pinIcons) {
        collapse(finish);
    } else {
        sendLength(cfg.restLength);
        finish();
    }
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
        spacerNow = 0;
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
    if (cfg.pinIcons) {
        // The spacer width is part of the applet configuration, so a shell
        // restart can carry a half-grown spacer from an interrupted animation.
        sendSpacerWidth(0);
        spacerNow = 0;
    }
    update();
}

init();
