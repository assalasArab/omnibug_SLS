/*
 * Omnibug dataLayer monitor — PAGE-WORLD script.
 * Injected as an inline <script> by the content script bridge at document_start.
 *
 * It wraps window.dataLayer.push() so we can capture every push. Events are sent
 * to the bridge (isolated world content script) via window.postMessage.
 *
 * We also capture any entries already in the dataLayer at the time of injection
 * (e.g. the initial GTM bootstrap push).
 */
(function () {
    "use strict";

    // Guard against double-injection on the same page
    if (window.__omnibugDataLayerMonitor) { return; }
    window.__omnibugDataLayerMonitor = true;

    // Names of globals commonly used for data layers
    const LAYER_NAMES = ["dataLayer", "adobeDataLayer", "digitalData"];

    /**
     * Safely serialize a dataLayer entry so it can cross the postMessage boundary.
     * Handles circular refs, functions, and non-cloneable objects.
     */
    function safeSerialize(entry) {
        const seen = new WeakSet();
        try {
            return JSON.parse(JSON.stringify(entry, function (key, value) {
                if (typeof value === "function") { return "[Function]"; }
                if (value && typeof value === "object") {
                    if (seen.has(value)) { return "[Circular]"; }
                    seen.add(value);
                }
                if (value instanceof Error) {
                    return { __error: true, name: value.name, message: value.message };
                }
                return value;
            }));
        } catch (e) {
            try { return { __unserializable: true, repr: String(entry) }; }
            catch (e2) { return { __unserializable: true, repr: "(unknown)" }; }
        }
    }

    /**
     * Post an event up to the bridge in the isolated world.
     */
    function notify(layerName, entry, origin) {
        try {
            window.postMessage({
                __omnibug: "dataLayerEvent",
                layer: layerName,
                payload: safeSerialize(entry),
                timestamp: Date.now(),
                origin: origin || "push"
            }, "*");
        } catch (e) { /* page refused postMessage? nothing we can do */ }
    }

    /**
     * Install a push-hook on a given dataLayer array.
     * Captures any pre-existing entries, then wraps push() so subsequent calls are forwarded.
     */
    function hookLayer(layerName) {
        // Ensure the global array exists and is an array
        let existing = window[layerName];
        if (!Array.isArray(existing)) {
            try { existing = window[layerName] = existing || []; }
            catch (e) { return false; }
        }

        // Mark to avoid double-hooking the same array
        if (existing.__omnibugHooked) { return true; }
        try { Object.defineProperty(existing, "__omnibugHooked", { value: true, enumerable: false }); }
        catch (e) { existing.__omnibugHooked = true; }

        // Replay any entries already in the array
        for (let i = 0; i < existing.length; i++) {
            notify(layerName, existing[i], "initial");
        }

        // Wrap push
        const originalPush = existing.push;
        existing.push = function () {
            for (let i = 0; i < arguments.length; i++) {
                notify(layerName, arguments[i], "push");
            }
            return originalPush.apply(this, arguments);
        };

        return true;
    }

    // Hook all known layer names now, and re-check periodically for layers that
    // get created AFTER our script runs (some sites lazy-init their dataLayer).
    function hookAll() {
        for (let i = 0; i < LAYER_NAMES.length; i++) {
            try { hookLayer(LAYER_NAMES[i]); } catch (e) { /* ignore */ }
        }
    }

    hookAll();

    // Re-check a few times shortly after load in case a layer is created late.
    // We stop once the page is idle to avoid wasting CPU.
    let checksLeft = 10;
    const interval = setInterval(function () {
        hookAll();
        if (--checksLeft <= 0) { clearInterval(interval); }
    }, 500);

    window.addEventListener("load", function () {
        // One final hook attempt after full load
        hookAll();
    });
})();
