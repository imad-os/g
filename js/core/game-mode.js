/* The TV's Game Mode (owner request 2026-11-28, package 3.2.0).
 * Samsung lets an app use the TV's Game Mode (low latency picture, like a console on HDMI) with ONE line in config.xml:
 *   <tizen:metadata key="http://samsung.com/tv/metadata/use.game.mode" value="true"/>
 * (developer.samsung.com, Smart TV > Cloud Gaming > "Implementing a web app": public, no privilege, 2022 and newer TVs,
 * Web Engine M85+). There is NO JavaScript call to switch it on or off while the app runs, so it is a fact of the installed
 * package, for the whole of My PC, not a setting: Control Panel > Gaming only tells what this TV has (GameMode.status()).
 *   'on'      = a Samsung TV from 2022 or newer (Tizen 6.5+) running package 3.2.0 or newer
 *   'package' = the package is older than 3.2.0: install the new .wgt
 *   'tv'      = a Samsung TV older than 2022
 *   'none'    = not a TV (browser, phone app) */
var GameMode = (function () {
    'use strict';
    var PKG = [3, 2, 0];
    function pkgVersion() {
        try { return String(tizen.application.getAppInfo().version || ''); } catch (e) { return ''; }
    }
    function newer(v, min) {
        var p = String(v).split('.'), i, a;
        for (i = 0; i < min.length; i++) { a = parseInt(p[i], 10) || 0; if (a !== min[i]) return a > min[i]; }
        return true;
    }
    function platform() {
        try { return parseFloat(tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')) || 0; } catch (e) { return 0; }
    }
    function status() {
        if (!window.tizen) return 'none';
        var pv = platform();
        if (pv && pv < 6.5) return 'tv';
        var v = pkgVersion();
        if (v && !newer(v, PKG)) return 'package';
        return 'on';
    }
    return { status: status, pkgVersion: pkgVersion, _newer: newer };
})();
